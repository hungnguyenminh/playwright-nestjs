import type { BrowserContextOptions } from 'playwright';

/** Desktop-only emulation knobs a job, script or profile can set. */
export interface Emulation {
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  permissions?: string[];
  colorScheme?: 'light' | 'dark' | 'no-preference';
  proxy?: { server: string; username?: string; password?: string };
  extraHTTPHeaders?: Record<string, string>;
  ignoreHTTPSErrors?: boolean;
  javaScriptEnabled?: boolean;
}

export const DEFAULT_VIEWPORT = { width: 1366, height: 768 };

/** Later sources win; nested objects are replaced, not deep-merged. */
export function mergeEmulation(
  ...sources: Array<Emulation | undefined | null>
): Emulation {
  return Object.assign({}, ...sources.filter(Boolean));
}

export function toContextOptions(e: Emulation): BrowserContextOptions {
  return {
    viewport: e.viewport ?? DEFAULT_VIEWPORT,
    userAgent: e.userAgent,
    locale: e.locale,
    timezoneId: e.timezoneId,
    geolocation: e.geolocation,
    permissions: e.permissions,
    colorScheme: e.colorScheme,
    proxy: e.proxy,
    extraHTTPHeaders: e.extraHTTPHeaders,
    ignoreHTTPSErrors: e.ignoreHTTPSErrors,
    javaScriptEnabled: e.javaScriptEnabled,
    acceptDownloads: true,
  };
}
