import { LAZY_KEYS } from './action.types.js';

const WHOLE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const PART = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Reads `a.b.0.c` from vars; `$index` style names are plain keys. */
export function lookup(vars: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (obj, key) =>
        obj == null ? undefined : (obj as Record<string, unknown>)[key],
      vars,
    );
}

/**
 * Replaces `{{path}}` references. A string that is *only* a reference keeps
 * the raw value (so `"{{items}}"` can yield an array); otherwise values are
 * stringified into the text. Lazy keys (nested actions, conditions) are left
 * untouched for the runner to interpolate when it gets to them.
 */
export function interpolate<T>(value: T, vars: Record<string, unknown>): T {
  if (typeof value === 'string') {
    const whole = WHOLE.exec(value);
    if (whole) return lookup(vars, whole[1]) as T;
    return value.replace(PART, (_, path: string) => {
      const v = lookup(vars, path);
      if (v == null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolate(v, vars)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        LAZY_KEYS.has(k) ? v : interpolate(v, vars),
      ]),
    ) as T;
  }
  return value;
}
