import type { HandlerMap } from './handler.js';

export const tabHandlers: HandlerMap = {
  async newTab(a, ctx) {
    const page = await ctx.context.newPage();
    ctx.setPage(page);
    if (a.url) {
      await page.goto(a.url, { waitUntil: 'domcontentloaded', timeout: a.timeout });
    }
    return `tab ${ctx.context.pages().indexOf(page)}`;
  },

  async switchTab(a, ctx) {
    const pages = ctx.context.pages();
    const page = pages[Number(a.index)];
    if (!page) throw new Error(`No tab ${a.index} (${pages.length} open)`);
    await page.bringToFront();
    ctx.setPage(page);
    return page.url();
  },

  async closeTab(a, ctx) {
    const target =
      a.index == null ? ctx.page : ctx.context.pages()[Number(a.index)];
    if (!target) throw new Error(`No tab ${a.index}`);
    await target.close();
    if (target === ctx.page) {
      const rest = ctx.context.pages();
      ctx.setPage(rest.at(-1) ?? (await ctx.context.newPage()));
    }
  },

  async frame(a, ctx, step) {
    const handle = await ctx
      .locator(a.selector)
      .first()
      .elementHandle({ timeout: a.timeout });
    const frame = await handle?.contentFrame();
    if (!frame) throw new Error(`${a.selector} is not an iframe`);
    const { root, scope } = ctx;
    ctx.root = frame;
    ctx.scope = undefined;
    try {
      await step.run(a.actions, 'actions');
    } finally {
      ctx.root = root;
      ctx.scope = scope;
    }
  },

  async dialog(a, ctx) {
    ctx.dialogPolicy = { accept: a.accept, promptText: a.promptText };
    return a.accept ? 'accept' : 'dismiss';
  },
};
