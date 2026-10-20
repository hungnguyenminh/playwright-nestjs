import type Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Page } from 'playwright';
import type { Action } from '../actions/action.types.js';
import { errorMessage } from '../actions/handlers/handler.js';
import { ActivityService } from '../activity/activity.service.js';
import { describeAiError, requestExtras } from '../ai/ai-client.js';
import { AI_CLIENT_FACTORY, type AiClientFactory } from '../ai/ai.service.js';
import { PageSnapshotService, snapshotOf, type PageSnapshot } from '../ai/page-snapshot.service.js';
import { Events, type TaskUpdatedEvent } from '../common/events.js';
import { Job, Task } from '../jobs/schemas.js';
import { AiSettingsService } from '../settings/ai-settings.service.js';
import { Publication } from './campaign.schema.js';
import { CampaignsService } from './campaigns.service.js';
import { keyFromLabel, SELECTOR_BY_KEY, type SelectorSpec } from './selectors.js';
import { SelectorsService } from './selectors.service.js';

/** Where a publish job was posting (stored in its task vars as __publish). */
export interface PublishTarget {
  platform: string;
  kind: 'self' | 'page' | 'group';
  url?: string;
}

export interface FixResult {
  ok: boolean;
  key: string;
  value?: string;
  previous?: string;
  reason?: string;
  message: string;
  rounds?: number;
}

/** Errors that mean "the element wasn't found / usable", i.e. the UI probably changed. */
const SELECTOR_ERROR = /Timeout \d+ms exceeded|waiting for locator|strict mode violation|not visible|not attached|No element matches|Element is outside/i;
const MAX_ROUNDS = 3;
/** Same key: at most this many AI fixes per day, and not twice within the cool-down. */
const MAX_FIXES_PER_DAY = 3;
const COOLDOWN_MS = 10 * 60_000;

const PROPOSE_TOOL: Anthropic.Beta.BetaTool = {
  name: 'propose_selector',
  description: 'Propose the new selector. Call exactly once.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['selector', 'reason'],
    properties: {
      selector: { type: 'string', description: 'Playwright selector (CSS plus :has-text(), :text-is(), comma = alternatives)' },
      reason: { type: 'string', description: 'One short sentence in Vietnamese: what changed on the page and what the new selector targets' },
    },
  },
};

const SYSTEM = [
  'You repair selectors of a browser automation tool that posts to social networks for its owner.',
  'A selector stopped matching because the site changed its UI (or a different kind of page uses different wording).',
  'You get: what the element is for, the old selector, the error, a compact outline of the live page (selectors, buttons, labels) and a screenshot.',
  'Rules:',
  '- Return a Playwright selector: CSS plus :has-text("…"), :text-is("…"), attribute selectors; a comma separates alternatives.',
  '- Keep working alternatives of the old selector and ADD what is needed (the same selector is used on other pages, e.g. a profile and a group): extend, do not replace, unless the old parts are clearly dead.',
  '- Prefer stable hooks: role, aria-label, visible text in Vietnamese and English. Never use generated class names (x1abc…) or positional nth-child.',
  '- Target exactly the element described; for dialog elements, scope with div[role=dialog].',
  '- Never target anything that would publish, delete or change settings unless that element is the one described.',
].join('\n');

/**
 * Repairs publisher selectors with the AI when a publish task fails on one
 * (before "Post" was pressed): reads the live page with the same profile,
 * asks for a new selector, checks it on the page (locating only, never
 * clicking "Post"), stores it as a new version and re-runs the publication.
 */
@Injectable()
export class SelectorDoctorService {
  private readonly logger = new Logger(SelectorDoctorService.name);
  private readonly running = new Set<string>();
  private readonly lastTry = new Map<string, number>();

  constructor(
    private readonly selectors: SelectorsService,
    private readonly snapshots: PageSnapshotService,
    private readonly settings: AiSettingsService,
    private readonly activity: ActivityService,
    private readonly campaigns: CampaignsService,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(Job.name) private readonly jobs: Model<Job>,
    @Inject(AI_CLIENT_FACTORY) private readonly clientFactory: AiClientFactory,
  ) {}

  /** A publish task failed: was it a selector, before posting? Then try to fix it. */
  @OnEvent(Events.TaskUpdated, { async: true })
  async onTask(e: TaskUpdatedEvent) {
    if (e.status !== 'failed') return;
    const task = await this.tasks.findById(e._id).lean();
    if (!task?.error?.stepPath) return;
    const result = (task.result ?? {}) as { submitted?: boolean };
    const job = await this.jobs.findById(task.jobId, { kind: 1, actions: 1, profileId: 1 }).lean();
    if (job?.kind !== 'publish' || result.submitted || !job.profileId) return;
    const key = keyFromLabel(actionAt(job.actions, task.error.stepPath)?.label);
    const target = (task.vars as { __publish?: PublishTarget })?.__publish;
    if (!key || !target || !SELECTOR_ERROR.test(task.error.message)) return;

    // The job may have been made before the latest change of this selector: just run it again.
    const changed = await this.selectors.lastChangeAt(key);
    if (changed && task.startedAt && changed > new Date(job._id.getTimestamp())) {
      await this.retryPublication(String(task._id), key, 'bộ chọn đã được sửa sau khi job này được tạo');
      return;
    }
    const last = this.lastTry.get(key) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) return;
    if ((await this.selectors.aiFixesSince(key, new Date(Date.now() - 86_400_000))) >= MAX_FIXES_PER_DAY) {
      this.activity.log({ actor: 'system', level: 'warn', category: 'selector', action: 'selector.aiFixLimit', summary: `Bộ chọn ${key} lỗi nhưng AI đã sửa ${MAX_FIXES_PER_DAY} lần hôm nay: cần người kiểm tra` });
      return;
    }
    this.lastTry.set(key, Date.now());
    const res = await this.fix(key, { profileId: String(job.profileId), target, error: task.error.message, taskId: String(task._id), trigger: 'auto' });
    if (res.ok) await this.retryPublication(String(task._id), key, 'AI đã sửa bộ chọn');
  }

  /** Repairs one selector against a destination with a profile (also used by the "Nhờ AI sửa" button). */
  async fix(key: string, ctx: { profileId: string; target: PublishTarget; error?: string; taskId?: string; trigger: 'auto' | 'manual' }): Promise<FixResult> {
    const spec = SELECTOR_BY_KEY.get(key);
    if (!spec) return { ok: false, key, message: `Không có bộ chọn ${key}` };
    if (this.running.has(key)) return { ok: false, key, message: 'AI đang sửa bộ chọn này' };
    this.running.add(key);
    const log = (summary: string, level: 'info' | 'warn' | 'error' = 'info', details?: Record<string, unknown>) =>
      this.activity.log({ actor: 'ai', level, category: 'selector', action: 'selector.doctor', summary, target: { type: 'selector', id: key, name: spec.label }, details });
    try {
      const cfg = await this.settings.resolve();
      if (!cfg.enabled || !cfg.token) {
        log(`Không tự sửa được "${spec.label}": chưa cấu hình AI`, 'warn');
        return { ok: false, key, message: 'Chưa cấu hình AI (Cài đặt → AI)' };
      }
      const current = await this.selectors.current();
      const old = current[key];
      const url = targetUrl(ctx.target);
      log(`AI bắt đầu sửa "${spec.label}" (${ctx.trigger === 'auto' ? 'tự động sau lỗi đăng bài' : 'theo yêu cầu'})`, 'info', { url, error: ctx.error, old });

      // 1. What the page looks like now (composer opened when the element lives in it).
      const snap = await this.snapshots.withPage(url, ctx.profileId, async (page) => {
        if (spec.scope === 'composer') await openComposer(page, current, spec);
        const s = await snapshotOf(page);
        await closeComposer(page, current, spec);
        return s;
      });

      // 2. Ask, check on the live page, feed back failures.
      const client = this.clientFactory(cfg);
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: request(spec, old, ctx.error, snap) }];
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        let msg: Anthropic.Beta.BetaMessage;
        try {
          msg = await client.beta.messages
            .stream({ model: cfg.model, max_tokens: 4_000, system: SYSTEM, tools: [PROPOSE_TOOL], tool_choice: { type: 'tool', name: PROPOSE_TOOL.name }, messages, ...requestExtras(cfg) })
            .finalMessage();
        } catch (err) {
          log(`AI lỗi khi sửa "${spec.label}": ${describeAiError(err)}`, 'error');
          return { ok: false, key, message: `AI lỗi: ${describeAiError(err)}` };
        }
        const call = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        const proposal = call?.input as { selector?: string; reason?: string } | undefined;
        const candidate = proposal?.selector?.trim();
        if (!call || !candidate) {
          messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: 'Hãy gọi propose_selector.' });
          continue;
        }
        const problem = await this.check(spec, candidate, url, ctx.profileId, current);
        if (!problem) {
          await this.selectors.set(key, candidate, { source: 'ai', reason: proposal?.reason, error: ctx.error, model: msg.model, taskId: ctx.taskId, validated: true });
          return { ok: true, key, value: candidate, previous: old, reason: proposal?.reason, message: 'Đã sửa và kiểm tra trên trang thật', rounds: round };
        }
        log(`Đề xuất lần ${round} cho "${spec.label}" chưa đạt: ${problem}`, 'warn', { candidate });
        messages.push(
          { role: 'assistant', content: msg.content },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Selector này chưa dùng được trên trang thật: ${problem}. Đề xuất selector khác.` }] },
        );
      }
      log(`AI không sửa được "${spec.label}" sau ${MAX_ROUNDS} lần: cần người kiểm tra`, 'error');
      return { ok: false, key, message: `AI không tìm được selector đúng sau ${MAX_ROUNDS} lần` };
    } catch (err) {
      log(`Không sửa được "${spec.label}": ${errorMessage(err)}`, 'error');
      return { ok: false, key, message: errorMessage(err) };
    } finally {
      this.running.delete(key);
    }
  }

  /** null when `candidate` finds the element on the live page (located only, never clicked). */
  private async check(spec: SelectorSpec, candidate: string, url: string, profileId: string, current: Record<string, string>): Promise<string | null> {
    try {
      return await this.snapshots.withPage(url, profileId, async (page) => {
        const sels = spec.key.endsWith('.composer') || spec.key === 'threads.compose' ? { ...current, [spec.key]: candidate } : current;
        if (spec.scope === 'composer') await openComposer(page, sels, spec);
        try {
          await page.locator(candidate).first().waitFor({ state: spec.check, timeout: 10_000 });
          return null;
        } catch (err) {
          return errorMessage(err);
        } finally {
          await closeComposer(page, sels, spec);
        }
      });
    } catch (err) {
      return errorMessage(err);
    }
  }

  /** Runs the publication of a failed task again (fresh job with the current selectors). */
  private async retryPublication(taskId: string, key: string, why: string) {
    const pub = await this.campaigns.publications.findOne({ taskId }).lean<Publication & { _id: unknown }>();
    if (!pub || pub.status !== 'failed') {
      this.activity.log({ actor: 'system', category: 'selector', action: 'selector.retryHint', summary: `Bộ chọn ${key}: ${why}. Hãy chạy lại thao tác (vd bấm Đăng thử lần nữa).` });
      return;
    }
    await this.campaigns.retryPublication(String(pub._id)).catch((err) => this.logger.warn(`Retry after selector fix failed: ${errorMessage(err)}`));
    this.activity.log({ actor: 'system', category: 'publish', action: 'publication.retryAfterFix', summary: `Đăng lại lượt bị lỗi (${why}: ${key})`, target: { type: 'publication', id: String(pub._id) } });
  }
}

function targetUrl(t: PublishTarget) {
  if (t.platform === 'threads') return 'https://www.threads.com/';
  return t.kind === 'self' || !t.url ? 'https://www.facebook.com/me' : t.url;
}

async function openComposer(page: Page, sels: Record<string, string>, spec: SelectorSpec) {
  const opener = spec.platform === 'threads' ? sels['threads.compose'] : sels['facebook.composer'];
  await page.locator(opener).first().click({ timeout: 15_000 });
  await page.waitForTimeout(2_500);
}

/** Leaves no draft and no dialog behind. */
async function closeComposer(page: Page, sels: Record<string, string>, spec: SelectorSpec) {
  if (spec.scope !== 'composer' && !(await page.locator('div[role=dialog]').count())) return;
  const close = sels['facebook.close'];
  await page.keyboard.press('Escape').catch(() => undefined);
  if (spec.platform === 'facebook') await page.locator(close).first().click({ timeout: 3_000 }).catch(() => undefined);
}

function request(spec: SelectorSpec, old: string, error: string | undefined, snap: PageSnapshot): Anthropic.Beta.BetaContentBlockParam[] {
  return [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: snap.screenshot } },
    {
      type: 'text',
      text: [
        `<element key="${spec.key}">${spec.label}\nPurpose: ${spec.purpose}\nMust be ${spec.check === 'attached' ? 'present in the DOM (it is hidden)' : 'visible'}${spec.scope === 'composer' ? ' inside the open composer dialog (already opened in the screenshot)' : ' on the page as loaded'}.</element>`,
        `<old_selector>${old}</old_selector>`,
        error ? `<error>${error.slice(0, 800)}</error>` : '',
        `<page url="${snap.url}" title="${snap.title}">\n${snap.outline}\n</page>`,
        'Propose the repaired selector with propose_selector.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

/** The action at a step path like "5" or "3.then.1" / "4.actions.2". */
export function actionAt(actions: Action[], path: string): Action | undefined {
  const parts = path.split('.');
  let list: unknown = actions;
  let current: Action | undefined;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/^\d+$/.test(p)) {
      current = (list as Action[] | undefined)?.[Number(p) - 1];
      list = undefined;
    } else {
      list = (current as unknown as Record<string, unknown> | undefined)?.[p];
    }
  }
  return current;
}
