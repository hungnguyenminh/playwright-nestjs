import type { Platform } from './platforms.js';
import { type ActiveHours, applyActiveHours, DAY, DEFAULT_TZ, HOUR, MINUTE, seeded, seededShuffle } from './time.js';

/**
 * Pure scheduling logic of publishing campaigns (no database, no browser):
 * - computeSlots: the times of a schedule (once / chosen times / every N);
 * - planPublications: one publication per slot × destination (× account);
 * - postIndexFor / pickProfile: which post and which account, chosen at run time;
 * - shiftPlan: moving the rest of the schedule after downtime ("continue the cycle").
 */

export type AccountMode = 'all' | 'rotate';
export type RotateStrategy = 'roundRobin' | 'random' | 'leastRecent';
export type Assignment = 'same' | 'rotate' | 'separate';

export interface DestinationLimits {
  /** Minutes between two posts of one profile at this destination (default 240). */
  minGapPerProfileMinutes: number;
  /** Posts per profile per day at this destination (default 2). */
  maxPerProfilePerDay: number;
  /** Days before the same post may go to this destination again (default 30). */
  noRepeatPostDays: number;
}

export interface DestinationSpec {
  platform: Platform;
  /** self = the account's own profile / channel. */
  kind: 'self' | 'page' | 'group';
  url?: string;
  profileIds: string[];
  accountMode: AccountMode;
  rotate?: { strategy: RotateStrategy; startOffset?: number };
  limits: DestinationLimits;
}

export type ScheduleSpec =
  | { mode: 'once'; at?: Date | string }
  | { mode: 'slots'; slots: Array<{ at: Date | string; postId?: string }> }
  | {
      mode: 'interval';
      startAt: Date | string;
      every: number;
      unit: 'minute' | 'hour' | 'day';
      /** Empty = no end (generated a week ahead at a time). */
      count?: number;
      jitterMinutes?: number;
      activeHours?: ActiveHours;
    };

export type PostSourceSpec =
  | { type: 'list'; postIds: string[]; separate?: Record<string, string[]> }
  | { type: 'flow'; flowId: string };

export interface CampaignSpec {
  _id: string;
  destinations: DestinationSpec[];
  postSource: PostSourceSpec;
  order: 'sequential' | 'random';
  whenExhausted: 'stop' | 'loop' | 'wait';
  assignment: Assignment;
  staggerMinutes: number;
  minGapMinutes: number;
  schedule: ScheduleSpec;
  timezone?: string;
}

export const DEFAULT_LIMITS: DestinationLimits = { minGapPerProfileMinutes: 240, maxPerProfilePerDay: 2, noRepeatPostDays: 30 };
/** How far ahead an endless schedule is generated. */
export const HORIZON_MS = 7 * DAY;

const UNIT_MS = { minute: MINUTE, hour: HOUR, day: DAY } as const;

export interface Slot {
  slot: number;
  /** Planned time (before jitter). */
  base: Date;
  /** Time with jitter, inside active hours. */
  at: Date;
  postId?: string;
}

/** State kept to keep generating an endless interval schedule later. */
export interface PlanCursor {
  nextSlot: number;
  nextBaseAt: Date;
}

/**
 * Times of a schedule. Interval slots chain: each one is `every` after the
 * previous; one that falls outside active hours moves to the next window's
 * start and the chain continues from there (no pile-up in the morning).
 */
export function computeSlots(
  c: Pick<CampaignSpec, '_id' | 'schedule' | 'timezone'>,
  opts: { now: Date; until?: Date; from?: PlanCursor },
): { slots: Slot[]; cursor?: PlanCursor } {
  const tz = c.timezone ?? DEFAULT_TZ;
  const s = c.schedule;
  if (s.mode === 'once') {
    const at = s.at ? new Date(s.at) : opts.now;
    return { slots: [{ slot: 0, base: at, at }] };
  }
  if (s.mode === 'slots') {
    return {
      slots: [...s.slots]
        .map((x) => ({ at: new Date(x.at), postId: x.postId }))
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .map((x, i) => ({ slot: i, base: x.at, at: x.at, postId: x.postId })),
    };
  }
  const step = Math.max(1, s.every) * UNIT_MS[s.unit];
  const until = opts.until ?? new Date(opts.now.getTime() + HORIZON_MS);
  const slots: Slot[] = [];
  let i = opts.from?.nextSlot ?? 0;
  let base = applyActiveHours(opts.from?.nextBaseAt ?? new Date(s.startAt), s.activeHours, tz);
  while ((s.count === undefined || i < s.count) && base.getTime() <= until.getTime()) {
    const j = s.jitterMinutes ? Math.round((seeded(`${c._id}:${i}`) * 2 - 1) * s.jitterMinutes) * MINUTE : 0;
    // Jitter never moves a slot before its planned time's window or before the previous slot.
    const prev = slots.at(-1)?.at.getTime() ?? 0;
    const at = new Date(Math.max(prev + MINUTE, applyActiveHours(new Date(base.getTime() + j), s.activeHours, tz).getTime()));
    slots.push({ slot: i, base, at });
    i++;
    base = applyActiveHours(new Date(base.getTime() + step), s.activeHours, tz);
  }
  const done = s.count !== undefined && i >= s.count;
  return { slots, cursor: done ? undefined : { nextSlot: i, nextBaseAt: base } };
}

export interface PlannedPublication {
  slot: number;
  destIndex: number;
  /** 'rotate' for rotating destinations, otherwise the profile id. */
  lane: string;
  /** Position of the profile in the destination (stagger, post assignment). */
  laneIndex: number;
  scheduledAt: Date;
  plannedProfileId?: string;
  plannedPostId?: string;
  /** Post pinned by a chosen-time slot. */
  postId?: string;
}

export function planPublications(c: CampaignSpec, slots: Slot[]): PlannedPublication[] {
  const out: PlannedPublication[] = [];
  for (const s of slots) {
    c.destinations.forEach((d, destIndex) => {
      if (!d.profileIds.length) return;
      if (d.accountMode === 'rotate') {
        const offset = d.rotate?.startOffset ?? 0;
        out.push({
          slot: s.slot,
          destIndex,
          lane: 'rotate',
          laneIndex: 0,
          scheduledAt: s.at,
          plannedProfileId: d.profileIds[(s.slot + offset) % d.profileIds.length],
          plannedPostId: s.postId ?? plannedPost(c, s.slot, 0, undefined),
          postId: s.postId,
        });
        return;
      }
      d.profileIds.forEach((profileId, k) => {
        out.push({
          slot: s.slot,
          destIndex,
          lane: profileId,
          laneIndex: k,
          scheduledAt: new Date(s.at.getTime() + k * c.staggerMinutes * MINUTE),
          plannedProfileId: profileId,
          plannedPostId: s.postId ?? plannedPost(c, s.slot, k, profileId),
          postId: s.postId,
        });
      });
    });
  }
  return out.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/** The post list a lane draws from (its own list with 'separate'). */
export function postListFor(c: Pick<CampaignSpec, 'postSource' | 'assignment'>, profileId?: string): string[] {
  if (c.postSource.type !== 'list') return [];
  if (c.assignment === 'separate' && profileId && c.postSource.separate?.[profileId]?.length) return c.postSource.separate[profileId];
  return c.postSource.postIds;
}

/**
 * Index in the lane's post list for slot × account, or null when the list is
 * used up (stop / wait). 'rotate' shifts account k by k posts.
 */
export function postIndexFor(
  c: Pick<CampaignSpec, '_id' | 'order' | 'whenExhausted' | 'assignment'>,
  slot: number,
  laneIndex: number,
  len: number,
): number | null {
  if (!len) return null;
  const n = slot + (c.assignment === 'rotate' ? laneIndex : 0);
  if (n >= len && c.whenExhausted !== 'loop') return null;
  const cycle = Math.floor(n / len);
  const pos = n % len;
  if (c.order === 'random') return seededShuffle([...Array(len).keys()], `${c._id}:${cycle}`)[pos];
  return pos;
}

function plannedPost(c: CampaignSpec, slot: number, laneIndex: number, profileId?: string) {
  const list = postListFor(c, profileId);
  const i = postIndexFor(c, slot, laneIndex, list.length);
  return i === null ? undefined : list[i];
}

/** Identity of a place to post, shared by every campaign (limits count per place, not per campaign). */
export function destinationKey(d: Pick<DestinationSpec, 'platform' | 'kind' | 'url'>, profileId?: string): string {
  return d.kind === 'self' ? `${d.platform}:self:${profileId ?? ''}` : `${d.platform}:${d.kind}:${(d.url ?? '').toLowerCase()}`;
}

// ---- choosing the account -------------------------------------------------------

export interface PublishHistoryItem {
  profileId: string;
  /** Same place across campaigns: see destinationKey(). */
  destKey: string;
  /** When it was posted (or started, if still running). */
  at: Date;
  postId?: string;
}

export interface ProfileState {
  needsLogin?: boolean;
  /** A folder profile currently open by another task. */
  busy?: boolean;
  /** Not a member / can't post at this destination (last check). */
  blocked?: boolean;
}

export interface PickContext {
  now: Date;
  destKey: string;
  dest: Pick<DestinationSpec, 'profileIds' | 'accountMode' | 'rotate' | 'limits'>;
  /** Fixed profile of an 'all' lane. */
  laneProfileId?: string;
  /** Rotation position of the destination. */
  cursor: number;
  /** Profiles already tried (and failed before posting) for this publication. */
  tried: string[];
  /** Recent posts of the profiles involved, every campaign and destination. */
  history: PublishHistoryItem[];
  /** Minutes between two posts of one profile anywhere. */
  minGapMinutes: number;
  state: Record<string, ProfileState | undefined>;
  seed: string;
}

export type PickResult = { profileId: string; cursor: number } | { wait: string };

/** Why a profile can't post now, or null when it can. */
export function profileBlock(profileId: string, ctx: PickContext): string | null {
  const st = ctx.state[profileId];
  if (st?.needsLogin) return 'cần đăng nhập lại';
  if (st?.blocked) return 'không có quyền đăng ở đây';
  if (st?.busy) return 'profile đang được dùng';
  const mine = ctx.history.filter((h) => h.profileId === profileId);
  const now = ctx.now.getTime();
  const last = Math.max(0, ...mine.map((h) => h.at.getTime()));
  if (last && now - last < ctx.minGapMinutes * MINUTE) return `vừa đăng cách đây ${Math.round((now - last) / MINUTE)}′`;
  const here = mine.filter((h) => h.destKey === ctx.destKey);
  const lastHere = Math.max(0, ...here.map((h) => h.at.getTime()));
  const { minGapPerProfileMinutes, maxPerProfilePerDay } = ctx.dest.limits;
  if (lastHere && now - lastHere < minGapPerProfileMinutes * MINUTE) return `chưa đủ ${minGapPerProfileMinutes}′ ở điểm đăng này`;
  if (here.filter((h) => now - h.at.getTime() < DAY).length >= maxPerProfilePerDay) return `đã đủ ${maxPerProfilePerDay} bài/ngày ở điểm đăng này`;
  return null;
}

export function pickProfile(ctx: PickContext): PickResult {
  if (ctx.dest.accountMode === 'all') {
    const id = ctx.laneProfileId!;
    const why = profileBlock(id, ctx);
    return why ? { wait: why } : { profileId: id, cursor: ctx.cursor };
  }
  const ids = ctx.dest.profileIds;
  const n = ids.length;
  if (!n) return { wait: 'điểm đăng không có profile' };
  const strategy = ctx.dest.rotate?.strategy ?? 'roundRobin';
  let order: Array<{ id: string; next: number }>;
  if (strategy === 'leastRecent') {
    const lastAt = (id: string) => Math.max(0, ...ctx.history.filter((h) => h.profileId === id && h.destKey === ctx.destKey).map((h) => h.at.getTime()));
    order = ids.map((id, i) => ({ id, i, t: lastAt(id) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => ({ id: x.id, next: ctx.cursor + 1 }));
  } else {
    const base = (ctx.dest.rotate?.startOffset ?? 0) + ctx.cursor;
    order = Array.from({ length: n }, (_, k) => {
      const pos = base + k;
      const round = Math.floor(pos / n);
      const list = strategy === 'random' ? seededShuffle(ids, `${ctx.seed}:${round}`) : ids;
      return { id: list[pos % n], next: ctx.cursor + k + 1 };
    });
  }
  const reasons: string[] = [];
  for (const o of order) {
    if (ctx.tried.includes(o.id)) continue;
    const why = profileBlock(o.id, ctx);
    if (!why) return { profileId: o.id, cursor: o.next };
    reasons.push(why);
  }
  return { wait: reasons.length ? `không profile nào đăng được lúc này (${[...new Set(reasons)].join('; ')})` : 'đã thử hết profile' };
}

// ---- downtime ---------------------------------------------------------------------

export interface ShiftItem {
  id: string;
  slot: number;
  scheduledAt: Date;
}

/**
 * "Continue the cycle": the earliest overdue publication runs now and every
 * later one moves by the same delay, so spacing (and the gap between
 * accounts) stays as planned. A slot that lands outside active hours moves to
 * the next window together with everything after it.
 */
export function shiftPlan(
  items: ShiftItem[],
  opts: { now: Date; from: Date; activeHours?: ActiveHours; timezone?: string },
): { moves: Array<{ id: string; scheduledAt: Date }>; delta: number } {
  const delta = opts.now.getTime() - opts.from.getTime();
  if (delta <= 0) return { moves: [], delta: 0 };
  const later = items.filter((x) => x.scheduledAt.getTime() >= opts.from.getTime()).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const bySlot = new Map<number, ShiftItem[]>();
  for (const x of later) bySlot.set(x.slot, [...(bySlot.get(x.slot) ?? []), x]);
  let extra = 0;
  const moves: Array<{ id: string; scheduledAt: Date }> = [];
  for (const group of [...bySlot.values()].sort((a, b) => a[0].scheduledAt.getTime() - b[0].scheduledAt.getTime())) {
    const start = Math.min(...group.map((x) => x.scheduledAt.getTime())) + delta + extra;
    const fixed = applyActiveHours(new Date(start), opts.activeHours, opts.timezone).getTime();
    extra += fixed - start;
    for (const x of group) moves.push({ id: x.id, scheduledAt: new Date(x.scheduledAt.getTime() + delta + extra) });
  }
  return { moves, delta: delta + extra };
}
