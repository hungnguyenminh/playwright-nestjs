import { HandlerMap, matchesUrl, randomBetween, sleep, urlMatcher } from './handler.js';

export const waitHandlers: HandlerMap = {
  async waitFor(a, ctx) {
    const timeout = a.timeout;
    if (a.selector) {
      await ctx
        .locator(a.selector)
        .first()
        .waitFor({ state: a.state ?? 'visible', timeout });
    }
    if (a.url) await ctx.page.waitForURL(urlMatcher(a.url), { timeout });
    if (a.loadState) await ctx.page.waitForLoadState(a.loadState, { timeout });
    if (a.response) {
      const res = await ctx.page.waitForResponse(
        (r) => matchesUrl(a.response!, r.url()),
        { timeout },
      );
      return `${res.status()} ${res.url()}`;
    }
  },
  async sleep(a, ctx) {
    const ms = Number(a.ms) + (a.jitter ? randomBetween(0, Number(a.jitter)) : 0);
    await sleep(ms, ctx.signal);
    return `${ms}ms`;
  },
  async pause(a, ctx) {
    await ctx.hooks.pause(a.message);
  },
};
