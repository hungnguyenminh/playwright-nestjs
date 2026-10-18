import Anthropic from '@anthropic-ai/sdk';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { ArtifactsService } from '../artifacts/artifacts.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ScriptsService } from '../scripts/scripts.service.js';
import { AiSettingsService } from '../settings/ai-settings.service.js';
import { type AiConfig, buildClient, requestExtras } from './ai-client.js';
import { AiAssistDto, AiTurn } from './ai.dto.js';
import {
  checkProposal,
  FORM_TOOLS,
  type FormContext,
  referencedVariables,
} from './forms.js';
import { PageSnapshotService } from './page-snapshot.service.js';
import { systemPrompt } from './prompts.js';

/** Overridable in tests. */
export const AI_CLIENT_FACTORY = Symbol('AI_CLIENT_FACTORY');
export type AiClientFactory = (cfg: AiConfig) => Pick<Anthropic, 'beta'>;

/** Server-sent events written to the browser. */
export type AiEmit = (
  event: 'status' | 'snapshot' | 'text' | 'proposal' | 'error' | 'done',
  data: unknown,
) => void;

/** First answer + up to two automatic repair rounds. */
const MAX_ROUNDS = 3;
const MAX_TOKENS = 32_000;
const MAX_FORM_CHARS = 30_000;
const MAX_SCREENSHOT_BYTES = 4_000_000;

type ImageBlock = Anthropic.Beta.BetaImageBlockParam;
type MessageParam = Anthropic.Beta.BetaMessageParam;

const json = (v: unknown) => JSON.stringify(v, null, 2);
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s;

/**
 * Turns a natural-language request into (1) a guide streamed as text and
 * (2) a form proposal via a strict tool call, validated with the same rules
 * the app uses on save; errors go back to the model for another round.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly scripts: ScriptsService,
    private readonly profiles: ProfilesService,
    private readonly jobs: JobsService,
    private readonly artifacts: ArtifactsService,
    private readonly snapshots: PageSnapshotService,
    @Inject(AI_CLIENT_FACTORY) private readonly clientFactory: AiClientFactory,
  ) {}

  async status() {
    const s = await this.settings.getPublic();
    return { configured: s.configured, model: s.model };
  }

  async assist(
    dto: AiAssistDto,
    emit: AiEmit,
    signal: AbortSignal,
  ): Promise<void> {
    const cfg = await this.settings.resolve();
    if (!cfg.enabled || !cfg.token) {
      throw new ServiceUnavailableException(
        'Trợ lý AI chưa được cấu hình. Vào Cài đặt → AI để nhập token và model.',
      );
    }
    const client = this.clientFactory(cfg);
    const ctx = await this.formContext();
    const images: ImageBlock[] = [];
    const parts: string[] = [];

    if (dto.fixTaskId) {
      emit('status', { message: 'Đang đọc thông tin task bị lỗi…' });
      const fix = await this.fixContext(dto.fixTaskId);
      parts.push(fix.text);
      if (fix.screenshot) images.push(fix.screenshot);
    }
    if (dto.snapshotUrl) {
      emit('status', { message: `Đang mở trang ${dto.snapshotUrl}…` });
      const snap = await this.snapshots.capture(
        dto.snapshotUrl,
        dto.snapshotProfileId,
        signal,
      );
      emit('snapshot', {
        url: snap.url,
        title: snap.title,
        screenshot: snap.screenshot,
      });
      parts.push(
        `<page_snapshot url="${snap.url}">\n${snap.outline}\n</page_snapshot>`,
      );
      images.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: snap.screenshot,
        },
      });
    }
    parts.push(this.listsText(dto.kind, ctx));
    if (dto.currentForm && Object.keys(dto.currentForm).length) {
      parts.push(
        `<current_form>\n${clip(json(dto.currentForm), MAX_FORM_CHARS)}\n</current_form>`,
      );
    }

    const messages: MessageParam[] = [
      ...this.historyMessages(dto.history),
      {
        role: 'user',
        content: [
          ...images,
          {
            type: 'text',
            text: `<context>\n${parts.join('\n\n')}\n</context>\n\n<request>\n${dto.prompt}\n</request>`,
          },
        ],
      },
    ];
    const tool = FORM_TOOLS[dto.kind];
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    emit('status', { message: `${cfg.model} đang viết…` });
    for (let round = 1; ; round++) {
      const stream = client.beta.messages.stream(
        {
          model: cfg.model,
          max_tokens: MAX_TOKENS,
          // Large and identical for every request of a kind: cached.
          system: [
            {
              type: 'text',
              text: systemPrompt(dto.kind),
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: [tool],
          messages,
          ...requestExtras(cfg),
        },
        { signal },
      );
      stream.on('text', (delta) => emit('text', { delta }));
      const msg = await stream.finalMessage();
      for (const k of Object.keys(usage) as (keyof typeof usage)[])
        usage[k] += msg.usage[k] ?? 0;

      if (msg.stop_reason === 'refusal') {
        emit('error', {
          message: 'AI từ chối yêu cầu này. Hãy diễn đạt lại yêu cầu.',
        });
        return;
      }
      const calls = msg.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      const call = calls.find((b) => b.name === tool.name);
      if (msg.stop_reason === 'max_tokens') {
        emit('error', {
          message: 'Câu trả lời quá dài nên bị cắt. Hãy chia nhỏ yêu cầu.',
        });
        return;
      }

      if (!call) {
        if (round >= MAX_ROUNDS) {
          emit('error', {
            message:
              'AI không đưa ra đề xuất để điền form. Hãy thử diễn đạt lại.',
          });
          return;
        }
        messages.push(
          { role: 'assistant', content: msg.content },
          {
            role: 'user',
            content: `Hãy gọi tool ${tool.name} với đề xuất đầy đủ.`,
          },
        );
        emit('text', { delta: '\n\n' });
        continue;
      }

      const proposal = checkProposal(
        dto.kind,
        call.input as Record<string, unknown>,
        ctx,
      );
      if (!proposal.errors.length || round >= MAX_ROUNDS) {
        emit('proposal', proposal);
        emit('done', { usage, rounds: round, model: msg.model });
        return;
      }

      emit('status', {
        message: `Đề xuất còn ${proposal.errors.length} lỗi, AI đang tự sửa (lần ${round})…`,
      });
      emit('text', { delta: '\n\n---\n\n' });
      messages.push(
        { role: 'assistant', content: msg.content },
        {
          role: 'user',
          content: calls.map((c) => ({
            type: 'tool_result' as const,
            tool_use_id: c.id,
            is_error: true,
            content:
              c === call
                ? `The proposal was rejected:\n${proposal.errors.map((e) => `- ${e}`).join('\n')}\nFix these and call ${tool.name} again.`
                : `Unknown tool. Only call ${tool.name}.`,
          })),
        },
      );
    }
  }

  /** Saved scripts and profiles: referenced by id in proposals and used to check them. */
  private async formContext(): Promise<FormContext> {
    const [scripts, profiles] = await Promise.all([
      this.scripts.listFull(),
      this.profiles.list(),
    ]);
    return {
      scripts: scripts.map((s) => ({
        _id: String(s._id),
        name: s.name,
        description: s.description,
        defaultVars: s.defaultVars ?? {},
        variables: referencedVariables(s.actions),
      })),
      profiles: profiles.map((p) => ({
        _id: String(p._id),
        name: p.name,
        notes: p.notes,
        inUse: !!p.inUse,
      })),
    };
  }

  private listsText(kind: AiAssistDto['kind'], ctx: FormContext): string {
    const profiles = ctx.profiles.length
      ? ctx.profiles
          .map(
            (p) =>
              `- ${p._id} | ${p.name}${p.notes ? ` | ${p.notes}` : ''}${p.inUse ? ' | (in use)' : ''}`,
          )
          .join('\n')
      : '(none)';
    if (kind !== 'job')
      return `<saved_profiles>\n${profiles}\n</saved_profiles>`;
    const scripts = ctx.scripts.length
      ? ctx.scripts
          .map(
            (s) =>
              `- ${s._id} | ${s.name} | ${s.description} | variables: ${s.variables.join(', ') || '(none)'} | defaults: ${JSON.stringify(s.defaultVars)}`,
          )
          .join('\n')
      : '(none)';
    return `<saved_scripts>\n${scripts}\n</saved_scripts>\n\n<saved_profiles>\n${profiles}\n</saved_profiles>`;
  }

  /** Earlier turns as plain text (no tool blocks to replay). */
  private historyMessages(history: AiTurn[] = []): MessageParam[] {
    return history.slice(-6).flatMap((t): MessageParam[] => [
      {
        role: 'user',
        content: String(t.prompt ?? '').slice(0, 8000) || '(empty)',
      },
      {
        role: 'assistant',
        content: `${String(t.guide ?? '').slice(0, 8000)}\n\n[Proposal sent to the form]\n${clip(json(t.proposal ?? {}), MAX_FORM_CHARS)}`,
      },
    ]);
  }

  /** What went wrong in a failed task: step, error, log tail, actions and the error screenshot. */
  private async fixContext(
    taskId: string,
  ): Promise<{ text: string; screenshot?: ImageBlock }> {
    const task = await this.jobs.getTask(taskId);
    const job = await this.jobs.get(String(task.jobId));
    const logs = (await this.jobs.taskLogs(taskId))
      .filter((l) => l.attempt === task.attempt)
      .slice(-30);
    const lines = logs.map(
      (l) =>
        `${l.path} ${l.type} ${l.status}${l.message ? `: ${l.message}` : ''}`,
    );
    let screenshot: ImageBlock | undefined;
    if (task.error?.screenshot) {
      try {
        const art = await this.artifacts.get(task.error.screenshot);
        if (art.size <= MAX_SCREENSHOT_BYTES) {
          const data = (await readFile(art.path)).toString('base64');
          screenshot = {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data },
          };
        }
      } catch (err) {
        this.logger.warn(
          `Error screenshot unavailable: ${(err as Error).message}`,
        );
      }
    }
    const text = [
      `<failed_task status="${task.status}" attempt="${task.attempt}">`,
      `Job: ${job.name}${job.scriptId ? ` (script ${job.scriptId})` : ' (inline actions)'}`,
      `Failed step: ${task.error?.stepPath ?? '?'} (${task.error?.actionType ?? '?'})`,
      `Error: ${task.error?.message ?? '(none)'}`,
      `Page URL at failure: ${task.currentUrl ?? '?'}`,
      `Task variables: ${JSON.stringify(task.vars)}`,
      `Step log (path type status: message):\n${lines.join('\n')}`,
      `Actions the task ran:\n${clip(json(job.actions), MAX_FORM_CHARS)}`,
      screenshot
        ? 'The attached image is the page at the moment of failure.'
        : '',
      '</failed_task>',
    ].join('\n');
    return { text, screenshot };
  }
}

/** Default factory: a real SDK client per resolved configuration. */
export const defaultClientFactory: AiClientFactory = (cfg) => buildClient(cfg);
