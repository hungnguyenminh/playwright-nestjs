/**
 * Time zone helpers without a date library: wall-clock parts of an instant in
 * a zone, the instant of a wall-clock time, and "active hours" windows.
 */
export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface ActiveHours {
  /** "HH:mm" */
  from: string;
  to: string;
}

const fmt = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmt.set(tz, f);
  }
  return f;
}

export function zonedParts(at: Date, tz = DEFAULT_TZ) {
  const p = Object.fromEntries(formatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Minutes the zone is ahead of UTC at that instant. */
export function tzOffsetMinutes(at: Date, tz = DEFAULT_TZ) {
  const p = zonedParts(at, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE);
}

/** The instant when the zone's clock shows y-m-d h:mi. */
export function zonedDate(y: number, m: number, d: number, h: number, mi: number, tz = DEFAULT_TZ) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - tzOffsetMinutes(new Date(guess), tz) * MINUTE;
  // Second pass settles offsets that change between the guess and the answer (DST).
  return new Date(guess - tzOffsetMinutes(new Date(first), tz) * MINUTE);
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

export function isValidHours(h?: ActiveHours) {
  return !h || (/^\d{1,2}:\d{2}$/.test(h.from) && /^\d{1,2}:\d{2}$/.test(h.to) && toMinutes(h.from) !== toMinutes(h.to));
}

/** `at` if inside the window, otherwise the next start of the window (today or tomorrow). */
export function applyActiveHours(at: Date, hours: ActiveHours | undefined, tz = DEFAULT_TZ): Date {
  if (!hours) return at;
  const from = toMinutes(hours.from);
  const to = toMinutes(hours.to);
  const p = zonedParts(at, tz);
  const now = p.h * 60 + p.mi;
  const inside = from < to ? now >= from && now < to : now >= from || now < to;
  if (inside) return at;
  const today = zonedDate(p.y, p.m, p.d, Math.floor(from / 60), from % 60, tz);
  return today.getTime() > at.getTime() ? today : new Date(zonedDate(p.y, p.m, p.d + 1, Math.floor(from / 60), from % 60, tz).getTime());
}

/** Deterministic pseudo-random in [0, 1) from a string seed (jitter, random order). */
export function seeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Fisher–Yates with a seed: the same seed always gives the same order. */
export function seededShuffle<T>(list: T[], seed: string): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(seeded(`${seed}:${i}`) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
