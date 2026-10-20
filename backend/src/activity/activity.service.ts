import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Activity, ActivityActor, ActivityLevel } from './activity.schema.js';

export interface ActivityInput {
  actor: ActivityActor;
  category: string;
  action: string;
  summary: string;
  level?: ActivityLevel;
  target?: { type: string; id?: unknown; name?: string };
  details?: Record<string, unknown>;
}

export interface ActivityQuery {
  actor?: string;
  category?: string;
  level?: string;
  q?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

/** Keys whose values never go into the log. */
const SECRET_KEY = /token|password|passwd|secret|cookie|session|authorization|apikey|api_key|sealed|storageState/i;
const MAX_STRING = 2_000;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Copy of a value with secrets masked and long strings / arrays cut, safe to store. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length} ký tự)` : value;
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => redact(v, depth + 1));
    return value.length > 50 ? [...items, `…(${value.length} mục)`] : items;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) && v ? '***' : redact(v, depth + 1)]),
    );
  }
  return value;
}

/**
 * The system-wide activity log: what users did (every change through the
 * API), what the app did on its own (runs, schedules, retries) and what the AI
 * changed. Writing never throws: a failed log write must not break the action.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(@InjectModel(Activity.name) private readonly activities: Model<Activity>) {}

  log(input: ActivityInput): void {
    const target = input.target ? { type: input.target.type, id: input.target.id ? String(input.target.id) : undefined, name: input.target.name } : undefined;
    const details = input.details ? (redact(input.details) as Record<string, unknown>) : undefined;
    const text = [input.summary, input.action, input.category, target?.name, target?.id, details ? JSON.stringify(details) : '']
      .join(' ')
      .toLowerCase()
      .slice(0, 4_000);
    this.activities
      .create({ at: new Date(), actor: input.actor, level: input.level ?? 'info', category: input.category, action: input.action, summary: input.summary, target, details, text })
      .catch((err) => this.logger.warn(`Activity not saved: ${(err as Error).message}`));
  }

  async list(q: ActivityQuery) {
    const filter: Record<string, unknown> = {};
    if (q.actor) filter.actor = { $in: q.actor.split(',') };
    if (q.category) filter.category = { $in: q.category.split(',') };
    if (q.level) filter.level = { $in: q.level.split(',') };
    if (q.q?.trim()) filter.text = { $regex: escapeRegex(q.q.trim().toLowerCase()) };
    if (q.from || q.to) filter.at = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(q.to) } : {}) };
    const [items, total] = await Promise.all([
      this.activities
        .find(filter, { text: 0 })
        .sort({ at: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.activities.countDocuments(filter),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  categories() {
    return this.activities.distinct('category');
  }
}
