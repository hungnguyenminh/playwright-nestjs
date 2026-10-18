import type { HandlerMap } from './handler.js';

export const navigationHandlers: HandlerMap = {
  async goto(a, ctx) {
    const res = await ctx.page.goto(a.url, {
      waitUntil: a.waitUntil ?? 'domcontentloaded',
      timeout: a.timeout,
    });
    return `${res?.status() ?? '-'} ${ctx.page.url()}`;
  },
  async back(a, ctx) {
    await ctx.page.goBack({ waitUntil: a.waitUntil, timeout: a.timeout });
    return ctx.page.url();
  },
  async forward(a, ctx) {
    await ctx.page.goForward({ waitUntil: a.waitUntil, timeout: a.timeout });
    return ctx.page.url();
  },
  async reload(a, ctx) {
    await ctx.page.reload({ waitUntil: a.waitUntil, timeout: a.timeout });
  },
};
