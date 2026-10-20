import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActivityService } from '../activity/activity.service.js';
import { SelectorVersion } from './selector.schema.js';
import { DEFAULT_SELECTORS, SELECTOR_BY_KEY, SELECTORS } from './selectors.js';

/** How long the current selectors are cached (they change rarely). */
const CACHE_MS = 5_000;

/** Versioned publisher selectors: current values, history, edits and reverts (all logged). */
@Injectable()
export class SelectorsService {
  private cache?: { at: number; value: Record<string, string> };

  constructor(
    @InjectModel(SelectorVersion.name) private readonly versions: Model<SelectorVersion>,
    private readonly activity: ActivityService,
  ) {}

  /** key → selector in use (latest version, else the default). */
  async current(): Promise<Record<string, string>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const latest = await this.versions.aggregate<{ _id: string; value: string }>([
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$key', value: { $first: '$value' } } },
    ]);
    const value = { ...DEFAULT_SELECTORS, ...Object.fromEntries(latest.filter((l) => SELECTOR_BY_KEY.has(l._id)).map((l) => [l._id, l.value])) };
    this.cache = { at: Date.now(), value };
    return value;
  }

  /** Registry with current value and last change, for the "Bộ đăng" page. */
  async list() {
    const current = await this.current();
    const last = await this.versions.aggregate<{ _id: string; doc: SelectorVersion & { _id: Types.ObjectId } }>([
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$key', doc: { $first: '$$ROOT' }, count: { $sum: 1 } } },
    ]);
    return SELECTORS.map((s) => {
      const l = last.find((x) => x._id === s.key)?.doc;
      return { ...s, current: current[s.key], isDefault: current[s.key] === s.default, lastChange: l ?? null };
    });
  }

  history(key: string) {
    this.spec(key);
    return this.versions.find({ key }).sort({ createdAt: -1, _id: -1 }).limit(100).lean();
  }

  async set(key: string, value: string, meta: { source: 'ai' | 'user'; reason?: string; error?: string; model?: string; taskId?: string; validated?: boolean }) {
    const spec = this.spec(key);
    const v = value.trim();
    if (!v) throw new BadRequestException('Selector trống');
    const previous = (await this.current())[key];
    if (previous === v) return null;
    const doc = await this.versions.create({
      key,
      value: v,
      previous,
      source: meta.source,
      reason: meta.reason ?? '',
      error: meta.error,
      model: meta.model,
      taskId: meta.taskId ? new Types.ObjectId(meta.taskId) : undefined,
      validated: !!meta.validated,
    });
    this.cache = undefined;
    this.activity.log({
      actor: meta.source,
      level: 'warn',
      category: 'selector',
      action: meta.source === 'ai' ? 'selector.aiFix' : 'selector.edit',
      summary: `${meta.source === 'ai' ? 'AI sửa' : 'Sửa'} bộ chọn "${spec.label}" (${key})${meta.reason ? `: ${meta.reason}` : ''}`,
      target: { type: 'selector', id: key, name: spec.label },
      details: { previous, value: v, reason: meta.reason, error: meta.error, model: meta.model, taskId: meta.taskId, validated: meta.validated },
    });
    return doc.toObject();
  }

  revert(key: string) {
    const spec = this.spec(key);
    return this.set(key, spec.default, { source: 'user', reason: 'Khôi phục giá trị mặc định' });
  }

  /** AI fixes of a key since a time (rate limit). */
  aiFixesSince(key: string, since: Date) {
    return this.versions.countDocuments({ key, source: 'ai', createdAt: { $gte: since } });
  }

  async lastChangeAt(key: string): Promise<Date | undefined> {
    return (await this.versions.findOne({ key }).sort({ createdAt: -1 }).lean())?.createdAt;
  }

  spec(key: string) {
    const s = SELECTOR_BY_KEY.get(key);
    if (!s) throw new NotFoundException(`Không có bộ chọn "${key}"`);
    return s;
  }
}
