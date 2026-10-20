import type Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { describeAiError, requestExtras } from '../ai/ai-client.js';
import { AI_CLIENT_FACTORY, type AiClientFactory } from '../ai/ai.service.js';
import { DataRecord } from '../data/data-record.schema.js';
import { MediaService } from '../media/media.service.js';
import type { Platform } from '../publish/platforms.js';
import { AiSettingsService } from '../settings/ai-settings.service.js';
import { checkWritten, systemPrompt, userMessage, WRITE_TOOL, type WriteOptions, type WrittenPost } from './post-writer.js';
import { Post } from './post.schema.js';
import { PostsService } from './posts.service.js';

/** Rows per AI request (per-record mode). */
const BATCH = 10;
const MAX_ROUNDS = 3;
const IMAGE_FIELDS = ['image', 'thumbnail', 'img', 'photo', 'cover'];

export interface GenerateRequest extends WriteOptions {
  recordIds: string[];
  /** Download the row's image (field image / thumbnail…) and attach it. */
  attachImage?: boolean;
  /** 'review' (default): posts are drafts to approve; 'auto': ready to publish. */
  approval?: 'review' | 'auto';
  tags?: string[];
}

export interface GenerateResult {
  created: Array<{ _id: Types.ObjectId; title: string; status: string }>;
  skipped: Array<{ recordId: string; reason: string }>;
  errors: string[];
}

/**
 * Writes posts from data rows with the configured AI, checks them against the
 * platforms' limits (asking the model to fix problems, up to 3 rounds), and
 * saves them in the post library linked to their rows, so a row never gets
 * two posts.
 */
@Injectable()
export class PostGeneratorService {
  private readonly logger = new Logger(PostGeneratorService.name);

  constructor(
    private readonly settings: AiSettingsService,
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(DataRecord.name) private readonly records: Model<DataRecord>,
    private readonly postsService: PostsService,
    private readonly media: MediaService,
    @Inject(AI_CLIENT_FACTORY) private readonly clientFactory: AiClientFactory,
  ) {}

  async generate(req: GenerateRequest, extra: { flowId?: Types.ObjectId } = {}): Promise<GenerateResult> {
    if (!req.platforms.length) throw new BadRequestException('Chọn ít nhất một nền tảng');
    const cfg = await this.settings.resolve();
    if (!cfg.enabled || !cfg.token) throw new ServiceUnavailableException('Trợ lý AI chưa được cấu hình (Cài đặt → AI).');
    const client = this.clientFactory(cfg);

    const ids = [...new Set(req.recordIds)].filter((id) => Types.ObjectId.isValid(id));
    const rows = await this.records.find({ _id: { $in: ids } }).lean();
    const used = new Set(
      (await this.posts.find({ 'sourceRecords.recordId': { $in: rows.map((r) => r._id) } }, { sourceRecords: 1 }).lean()).flatMap((p) =>
        p.sourceRecords.map((s) => String(s.recordId)),
      ),
    );
    const result: GenerateResult = { created: [], skipped: [], errors: [] };
    const todo = rows.filter((r) => {
      if (used.has(String(r._id))) result.skipped.push({ recordId: String(r._id), reason: 'Dòng này đã có bài' });
      return !used.has(String(r._id));
    });
    for (const id of ids) if (!rows.some((r) => String(r._id) === id)) result.skipped.push({ recordId: id, reason: 'Không tìm thấy dòng dữ liệu' });

    const size = req.mode === 'digest' ? Math.max(1, req.digestSize ?? 5) * 3 : BATCH;
    for (let i = 0; i < todo.length; i += size) {
      const batch = todo.slice(i, i + size);
      let written: WrittenPost[];
      try {
        written = await this.write(client, cfg, batch.map((r) => r.data), req);
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
        continue;
      }
      for (const w of written) {
        const sources = [...new Set(w.source_indexes)].filter((x) => batch[x]).map((x) => batch[x]);
        if (!sources.length) continue;
        result.created.push(await this.save(w, sources, req, extra));
      }
    }
    return result;
  }

  /** One AI request (plus fix-up rounds) for a batch of rows. */
  private async write(
    client: ReturnType<AiClientFactory>,
    cfg: Awaited<ReturnType<AiSettingsService['resolve']>>,
    rows: Array<Record<string, unknown>>,
    o: WriteOptions,
  ): Promise<WrittenPost[]> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userMessage(rows, o) }];
    for (let round = 1; ; round++) {
      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = await client.beta.messages
          .stream({
            model: cfg.model,
            max_tokens: 16_000,
            system: [{ type: 'text', text: systemPrompt(o), cache_control: { type: 'ephemeral' } }],
            tools: [WRITE_TOOL],
            tool_choice: { type: 'tool', name: WRITE_TOOL.name },
            messages,
            ...requestExtras(cfg),
          })
          .finalMessage();
      } catch (err) {
        throw new Error(`AI lỗi: ${describeAiError(err)}`);
      }
      if (msg.stop_reason === 'refusal') throw new Error('AI từ chối viết bài cho dữ liệu này');
      if (msg.stop_reason === 'max_tokens') throw new Error('Bài viết quá dài so với giới hạn của một lần gọi AI, hãy giảm số dòng');
      const call = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === WRITE_TOOL.name);
      const posts = ((call?.input as { posts?: WrittenPost[] } | undefined)?.posts ?? []).map((p) => ({
        title: String(p.title ?? '').slice(0, 300) || 'Bài AI',
        content: String(p.content ?? ''),
        hashtags: (Array.isArray(p.hashtags) ? p.hashtags : []).map(String),
        source_indexes: (Array.isArray(p.source_indexes) ? p.source_indexes : []).map(Number),
      }));
      const errors = call ? checkWritten(posts, rows.length, o) : ['Hãy gọi tool save_posts.'];
      if (!errors.length) return posts;
      if (round >= MAX_ROUNDS) {
        this.logger.warn(`AI posts still have problems after ${round} rounds: ${errors.join('; ')}`);
        // Keep the usable ones; the rest is reported.
        const ok = posts.filter((_, i) => !errors.some((e) => e.startsWith(`Bài ${i + 1}`)));
        if (!ok.length) throw new Error(`AI viết chưa đạt sau ${round} lần: ${errors.slice(0, 3).join('; ')}`);
        return ok;
      }
      messages.push(
        { role: 'assistant', content: msg.content },
        {
          role: 'user',
          content: call
            ? [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Chưa đạt:\n${errors.map((e) => `- ${e}`).join('\n')}\nSửa và gọi save_posts lại với toàn bộ bài.` }]
            : 'Hãy gọi tool save_posts với toàn bộ bài.',
        },
      );
    }
  }

  private async save(w: WrittenPost, sources: Array<DataRecord & { _id: Types.ObjectId }>, req: GenerateRequest, extra: { flowId?: Types.ObjectId }) {
    const mediaIds: string[] = [];
    if (req.attachImage) {
      for (const r of sources) {
        const url = IMAGE_FIELDS.map((f) => r.data[f]).find((v): v is string => typeof v === 'string' && /^https?:\/\//.test(v));
        if (!url) continue;
        const m = await this.media.fromUrl(url).catch(() => null);
        if (m) mediaIds.push(String(m._id));
        if (req.mode !== 'digest' || mediaIds.length >= 4) break;
      }
    }
    const link = sources.length === 1 ? ['url', 'link'].map((f) => sources[0].data[f]).find((v): v is string => typeof v === 'string' && /^https?:\/\//.test(v)) : undefined;
    const dto = {
      title: w.title,
      content: w.content.trim(),
      hashtags: w.hashtags,
      mediaIds,
      ...(link ? { link } : {}),
      platforms: Object.fromEntries(req.platforms.map((p: Platform) => [p, {}])),
      tags: req.tags ?? [],
    };
    const meta = {
      origin: 'ai' as const,
      flowId: extra.flowId,
      sourceRecords: sources.map((r) => ({ recordId: r._id, scope: r.scope, dataset: r.dataset })),
    };
    // 'auto' approval only when the post passes every platform's checks; otherwise it waits as a draft.
    if (req.approval === 'auto') {
      const ready = await this.postsService.create({ ...dto, status: 'ready' }, meta).catch(() => null);
      if (ready) return { _id: ready._id as Types.ObjectId, title: ready.title, status: ready.status };
    }
    const draft = await this.postsService.create({ ...dto, status: 'draft' }, meta);
    return { _id: draft._id as Types.ObjectId, title: draft.title, status: draft.status };
  }
}
