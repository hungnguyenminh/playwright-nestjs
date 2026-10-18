import type { Action, ActionOf, ActionType } from '../action.types.js';
import type { RunContext } from '../run-context.js';

export interface Step {
  path: string;
  /** Run a nested action list; `key` becomes part of child paths ("3.then.1"). */
  run(actions: Action[], key: string): Promise<void>;
}

/** Returns an optional short message for the step log. */
export type Handler<T extends ActionType = ActionType> = (
  action: ActionOf<T>,
  ctx: RunContext,
  step: Step,
) => Promise<string | void>;

export type HandlerMap = { [T in ActionType]?: Handler<T> };

/**
 * URL matcher accepted by Playwright: `/regex/flags`, a glob with `*`, or
 * otherwise a plain substring.
 */
export function urlMatcher(pattern: string): RegExp | string | ((u: URL) => boolean) {
  const re = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
  if (re) return new RegExp(re[1], re[2]);
  if (pattern.includes('*')) return pattern;
  return (u: URL) => u.href.includes(pattern);
}

export function matchesUrl(pattern: string, url: string): boolean {
  const m = urlMatcher(pattern);
  if (m instanceof RegExp) return m.test(url);
  if (typeof m === 'function') return m(new URL(url));
  const glob = new RegExp(
    '^' +
      m
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        // oxlint-disable-next-line no-control-regex -- \u0000 is our `**` placeholder
        .replace(/\u0000/g, '.*') +
      '$',
  );
  return glob.test(url);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const randomBetween = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1));

/** Playwright errors carry a long call log; keep the first useful lines. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split('\n').slice(0, 3).join(' | ').slice(0, 500);
}
