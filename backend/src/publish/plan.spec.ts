import { parseFacebookUrl } from './facebook-url.js';
import {
  type CampaignSpec,
  computeSlots,
  DEFAULT_LIMITS,
  type PickContext,
  pickProfile,
  planPublications,
  postIndexFor,
  shiftPlan,
} from './plan.js';
import { applyActiveHours, zonedDate, zonedParts } from './time.js';

/** Wall-clock time in Vietnam → Date. */
const vn = (d: number, h: number, mi = 0) => zonedDate(2026, 10, d, h, mi);
const hhmm = (x: Date) => {
  const p = zonedParts(x);
  return `${p.d}/${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
};

const campaign = (over: Partial<CampaignSpec> = {}): CampaignSpec => ({
  _id: 'c1',
  destinations: [],
  postSource: { type: 'list', postIds: ['B1', 'B2', 'B3', 'B4', 'B5'] },
  order: 'sequential',
  whenExhausted: 'loop',
  assignment: 'same',
  staggerMinutes: 60,
  minGapMinutes: 60,
  schedule: { mode: 'interval', startAt: vn(20, 8), every: 1, unit: 'hour', count: 3 },
  ...over,
});

describe('time helpers', () => {
  it('converts Vietnam wall-clock times and applies active hours', () => {
    expect(vn(20, 8).toISOString()).toBe('2026-10-20T01:00:00.000Z');
    const hours = { from: '07:00', to: '23:00' };
    expect(hhmm(applyActiveHours(vn(20, 10), hours))).toBe('20/10:00');
    expect(hhmm(applyActiveHours(vn(20, 5), hours))).toBe('20/07:00');
    expect(hhmm(applyActiveHours(vn(20, 23, 30), hours))).toBe('21/07:00');
    // overnight window
    expect(hhmm(applyActiveHours(vn(20, 1), { from: '22:00', to: '02:00' }))).toBe('20/01:00');
    expect(hhmm(applyActiveHours(vn(20, 12), { from: '22:00', to: '02:00' }))).toBe('20/22:00');
  });
});

describe('computeSlots', () => {
  it('once, chosen times, every N with active hours chaining (no morning pile-up)', () => {
    const now = vn(20, 9);
    expect(computeSlots(campaign({ schedule: { mode: 'once' } }), { now }).slots[0].at).toEqual(now);
    expect(
      computeSlots(campaign({ schedule: { mode: 'slots', slots: [{ at: vn(21, 9) }, { at: vn(20, 15), postId: 'B9' }] } }), { now }).slots.map((s) => [hhmm(s.at), s.postId]),
    ).toEqual([['20/15:00', 'B9'], ['21/09:00', undefined]]);

    const { slots, cursor } = computeSlots(
      campaign({ schedule: { mode: 'interval', startAt: vn(20, 21), every: 1, unit: 'hour', count: 5, activeHours: { from: '07:00', to: '23:00' } } }),
      { now },
    );
    expect(slots.map((s) => hhmm(s.at))).toEqual(['20/21:00', '20/22:00', '21/07:00', '21/08:00', '21/09:00']);
    expect(cursor).toBeUndefined();
  });

  it('endless schedules are generated a week at a time and continue from the cursor', () => {
    const c = campaign({ schedule: { mode: 'interval', startAt: vn(20, 8), every: 1, unit: 'day' } });
    const first = computeSlots(c, { now: vn(20, 7) });
    expect(first.slots).toHaveLength(7);
    expect(first.cursor).toMatchObject({ nextSlot: 7 });
    const next = computeSlots(c, { now: vn(27, 7), from: first.cursor });
    expect(next.slots[0]).toMatchObject({ slot: 7 });
    expect(hhmm(next.slots[0].at)).toBe('27/08:00');
  });

  it('jitter stays within ± minutes and keeps the order', () => {
    const { slots } = computeSlots(campaign({ schedule: { mode: 'interval', startAt: vn(20, 8), every: 1, unit: 'hour', count: 20, jitterMinutes: 10 } }), { now: vn(20, 7) });
    slots.forEach((s, i) => {
      expect(Math.abs(s.at.getTime() - s.base.getTime())).toBeLessThanOrEqual(10 * 60_000);
      if (i) expect(s.at.getTime()).toBeGreaterThan(slots[i - 1].at.getTime());
    });
  });
});

describe('planPublications and post assignment', () => {
  const allDest = { platform: 'facebook' as const, kind: 'self' as const, profileIds: ['A', 'B', 'C'], accountMode: 'all' as const, limits: DEFAULT_LIMITS };

  it.each([
    ['same', [['A', 'B1'], ['B', 'B1'], ['C', 'B1'], ['A', 'B2'], ['B', 'B2'], ['C', 'B2']]],
    ['rotate', [['A', 'B1'], ['B', 'B2'], ['C', 'B3'], ['A', 'B2'], ['B', 'B3'], ['C', 'B4']]],
  ] as const)('assignment %s, accounts staggered by 60′', (assignment, expected) => {
    const c = campaign({ assignment, destinations: [allDest], schedule: { mode: 'interval', startAt: vn(20, 8), every: 1, unit: 'day', count: 2 } });
    const pubs = planPublications(c, computeSlots(c, { now: vn(20, 7) }).slots);
    expect(pubs.map((p) => [p.plannedProfileId, p.plannedPostId])).toEqual(expected);
    expect(pubs.slice(0, 3).map((p) => hhmm(p.scheduledAt))).toEqual(['20/08:00', '20/09:00', '20/10:00']);
  });

  it('separate lists per account', () => {
    const c = campaign({
      assignment: 'separate',
      postSource: { type: 'list', postIds: ['B1'], separate: { A: ['A1', 'A2'], B: ['B7', 'B8'] } },
      destinations: [{ ...allDest, profileIds: ['A', 'B'] }],
      schedule: { mode: 'interval', startAt: vn(20, 8), every: 1, unit: 'day', count: 2 },
    });
    expect(planPublications(c, computeSlots(c, { now: vn(20, 7) }).slots).map((p) => p.plannedPostId)).toEqual(['A1', 'B7', 'A2', 'B8']);
  });

  it('rotating destination: one publication per slot, accounts in turn', () => {
    const c = campaign({
      destinations: [{ platform: 'facebook', kind: 'group', url: 'https://www.facebook.com/groups/g', profileIds: ['A', 'B', 'C', 'D'], accountMode: 'rotate', limits: DEFAULT_LIMITS }],
      schedule: { mode: 'interval', startAt: vn(20, 8), every: 1, unit: 'hour', count: 6 },
    });
    const pubs = planPublications(c, computeSlots(c, { now: vn(20, 7) }).slots);
    expect(pubs.map((p) => [hhmm(p.scheduledAt), p.plannedProfileId, p.plannedPostId])).toEqual([
      ['20/08:00', 'A', 'B1'],
      ['20/09:00', 'B', 'B2'],
      ['20/10:00', 'C', 'B3'],
      ['20/11:00', 'D', 'B4'],
      ['20/12:00', 'A', 'B5'],
      ['20/13:00', 'B', 'B1'],
    ]);
  });

  it('used-up lists stop / wait unless looping; random order is a stable shuffle per cycle', () => {
    expect(postIndexFor({ _id: 'c', order: 'sequential', whenExhausted: 'stop', assignment: 'same' }, 5, 0, 5)).toBeNull();
    expect(postIndexFor({ _id: 'c', order: 'sequential', whenExhausted: 'loop', assignment: 'same' }, 7, 0, 5)).toBe(2);
    const cyc = [0, 1, 2, 3, 4].map((s) => postIndexFor({ _id: 'c', order: 'random', whenExhausted: 'loop', assignment: 'same' }, s, 0, 5));
    expect([...cyc].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(postIndexFor({ _id: 'c', order: 'random', whenExhausted: 'loop', assignment: 'same' }, 2, 0, 5)).toBe(cyc[2]);
  });
});

describe('pickProfile', () => {
  const now = vn(20, 12);
  const ctx = (over: Partial<PickContext> = {}): PickContext => ({
    now,
    destKey: 'g',
    dest: { profileIds: ['A', 'B', 'C', 'D'], accountMode: 'rotate', rotate: { strategy: 'roundRobin' }, limits: DEFAULT_LIMITS },
    cursor: 0,
    tried: [],
    history: [],
    minGapMinutes: 60,
    state: {},
    seed: 's',
    ...over,
  });

  it('round robin from the cursor, skipping broken, busy and cooling-down profiles', () => {
    expect(pickProfile(ctx())).toEqual({ profileId: 'A', cursor: 1 });
    expect(pickProfile(ctx({ cursor: 1 }))).toEqual({ profileId: 'B', cursor: 2 });
    expect(pickProfile(ctx({ cursor: 3 }))).toEqual({ profileId: 'D', cursor: 4 });
    expect(pickProfile(ctx({ cursor: 4 }))).toEqual({ profileId: 'A', cursor: 5 });
    expect(pickProfile(ctx({ state: { A: { needsLogin: true }, B: { busy: true } } }))).toEqual({ profileId: 'C', cursor: 3 });
    // A posted here 2h ago (< 240′), B posted in another place 30′ ago (< 60′ global gap)
    const history = [
      { profileId: 'A', destKey: 'g', at: new Date(now.getTime() - 2 * 3_600_000) },
      { profileId: 'B', destKey: 'other', at: new Date(now.getTime() - 30 * 60_000) },
    ];
    expect(pickProfile(ctx({ history }))).toEqual({ profileId: 'C', cursor: 3 });
    // tried (failed before posting) → next one
    expect(pickProfile(ctx({ tried: ['A'] }))).toEqual({ profileId: 'B', cursor: 2 });
  });

  it('daily limit and nobody available → wait with reasons', () => {
    const day = (h: number, id: string) => ({ profileId: id, destKey: 'g', at: new Date(now.getTime() - h * 3_600_000) });
    const history = ['A', 'B', 'C', 'D'].flatMap((id) => [day(5, id), day(10, id)]);
    const r = pickProfile(ctx({ history }));
    expect(r).toEqual({ wait: 'không profile nào đăng được lúc này (đã đủ 2 bài/ngày ở điểm đăng này)' });
  });

  it('least recent and start offset', () => {
    const history = [
      { profileId: 'A', destKey: 'g', at: new Date(now.getTime() - 5 * 3_600_000) },
      { profileId: 'C', destKey: 'g', at: new Date(now.getTime() - 9 * 3_600_000) },
    ];
    expect(pickProfile(ctx({ history, dest: { ...ctx().dest, rotate: { strategy: 'leastRecent' } } }))).toMatchObject({ profileId: 'B' });
    expect(pickProfile(ctx({ dest: { ...ctx().dest, rotate: { strategy: 'roundRobin', startOffset: 2 } } }))).toMatchObject({ profileId: 'C' });
  });

  it("'all' lanes keep their account and wait instead of switching", () => {
    const history = [{ profileId: 'B', destKey: 'other', at: new Date(now.getTime() - 10 * 60_000) }];
    expect(pickProfile(ctx({ dest: { ...ctx().dest, accountMode: 'all' }, laneProfileId: 'B', history }))).toEqual({ wait: 'vừa đăng cách đây 10′' });
  });
});

describe('shiftPlan', () => {
  it('machine off 10:30 → 14:20: #2 runs now, the rest keeps the 1 h spacing', () => {
    const items = [11, 12, 13, 14].map((h, i) => ({ id: `#${i + 2}`, slot: i + 1, scheduledAt: vn(20, h) }));
    const { moves } = shiftPlan(items, { now: vn(20, 14, 20), from: vn(20, 11) });
    expect(moves.map((m) => [m.id, hhmm(m.scheduledAt)])).toEqual([
      ['#2', '20/14:20'],
      ['#3', '20/15:20'],
      ['#4', '20/16:20'],
      ['#5', '20/17:20'],
    ]);
  });

  it('keeps the stagger between accounts and respects active hours', () => {
    const items = [
      { id: 'a1', slot: 1, scheduledAt: vn(20, 20) },
      { id: 'b1', slot: 1, scheduledAt: vn(20, 21) },
      { id: 'a2', slot: 2, scheduledAt: vn(21, 8) },
    ];
    const { moves } = shiftPlan(items, { now: vn(20, 22, 30), from: vn(20, 20), activeHours: { from: '07:00', to: '23:00' } });
    expect(moves.map((m) => [m.id, hhmm(m.scheduledAt)])).toEqual([
      ['a1', '20/22:30'],
      ['b1', '20/23:30'],
      ['a2', '21/10:30'],
    ]);
  });
});

describe('parseFacebookUrl', () => {
  it.each([
    ['https://m.facebook.com/groups/caulong/?ref=share', { kind: 'group', url: 'https://www.facebook.com/groups/caulong' }],
    ['fb.com/groups/123456', { kind: 'group', url: 'https://www.facebook.com/groups/123456' }],
    ['https://web.facebook.com/MyShop.vn', { kind: 'page', url: 'https://www.facebook.com/MyShop.vn' }],
    ['https://www.facebook.com/profile.php?id=1000123', { kind: 'page', url: 'https://www.facebook.com/profile.php?id=1000123' }],
    ['https://www.facebook.com/pages/Shop/987654', { kind: 'page', url: 'https://www.facebook.com/987654' }],
  ])('accepts %s', (raw, expected) => {
    expect(parseFacebookUrl(raw)).toMatchObject(expected);
  });

  it.each([
    'https://www.facebook.com/groups/caulong/posts/123',
    'https://www.facebook.com/groups/caulong/permalink/123',
    'https://www.facebook.com/events/1',
    'https://www.facebook.com/watch?v=1',
    'https://www.facebook.com/marketplace/item/1',
    'https://www.facebook.com/reel/1',
    'https://www.facebook.com/MyShop/posts/pfbid0',
    'https://www.facebook.com/photo/?fbid=1',
    'https://www.facebook.com/share/abc',
    'https://www.facebook.com/story.php?story_fbid=1',
    'https://www.facebook.com/permalink.php?story_fbid=1',
    'https://www.youtube.com/@abc',
  ])('refuses %s', (raw) => {
    expect(parseFacebookUrl(raw)).toHaveProperty('error');
  });
});
