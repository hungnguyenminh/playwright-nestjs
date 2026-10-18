import { HandlerMap, randomBetween, sleep } from './handler.js';

export const interactionHandlers: HandlerMap = {
  async click(a, ctx) {
    const loc = ctx.locator(a.selector).first();
    const opts = {
      button: a.button,
      modifiers: a.modifiers,
      position: a.position,
      force: a.force,
      timeout: a.timeout,
    };
    if (!a.waitForNavigation) return void (await loc.click(opts));
    const nav = ctx.page.waitForEvent('framenavigated', { timeout: a.timeout });
    await loc.click(opts);
    await nav;
    await ctx.page.waitForLoadState('domcontentloaded', { timeout: a.timeout });
    return ctx.page.url();
  },
  async dblclick(a, ctx) {
    await ctx.locator(a.selector).first().dblclick({
      button: a.button,
      position: a.position,
      force: a.force,
      timeout: a.timeout,
    });
  },
  async hover(a, ctx) {
    await ctx.locator(a.selector).first().hover({ timeout: a.timeout });
  },
  async focus(a, ctx) {
    await ctx.locator(a.selector).first().focus({ timeout: a.timeout });
  },
  async fill(a, ctx) {
    await ctx.locator(a.selector).first().fill(String(a.value), { timeout: a.timeout });
  },
  async clear(a, ctx) {
    await ctx.locator(a.selector).first().clear({ timeout: a.timeout });
  },
  async type(a, ctx) {
    if (a.selector) {
      await ctx.locator(a.selector).first().focus({ timeout: a.timeout });
    }
    const text = String(a.text);
    if (a.delay != null) {
      await ctx.page.keyboard.type(text, { delay: a.delay });
      return;
    }
    // Uneven rhythm reads more like a person than a fixed delay.
    for (const ch of text) {
      await ctx.page.keyboard.type(ch);
      await sleep(randomBetween(50, 150), ctx.signal);
    }
  },
  async press(a, ctx) {
    if (a.selector) {
      await ctx.locator(a.selector).first().press(a.key, { timeout: a.timeout });
    } else {
      await ctx.page.keyboard.press(a.key);
    }
  },
  async check(a, ctx) {
    await ctx.locator(a.selector).first().check({ timeout: a.timeout });
  },
  async uncheck(a, ctx) {
    await ctx.locator(a.selector).first().uncheck({ timeout: a.timeout });
  },
  async select(a, ctx) {
    const chosen = await ctx
      .locator(a.selector)
      .first()
      .selectOption(a.value, { timeout: a.timeout });
    return chosen.join(', ');
  },
  async upload(a, ctx) {
    await ctx.locator(a.selector).first().setInputFiles(a.files, { timeout: a.timeout });
  },
  async drag(a, ctx) {
    await ctx
      .locator(a.source)
      .first()
      .dragTo(ctx.locator(a.target).first(), { timeout: a.timeout });
  },
  async scroll(a, ctx) {
    if (a.untilEnd) {
      const max = a.maxScrolls ?? 30;
      let lastHeight = -1;
      let stable = 0;
      for (let i = 0; i < max; i++) {
        const height = await ctx.page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          return document.documentElement.scrollHeight;
        });
        await sleep(800, ctx.signal);
        stable = height === lastHeight ? stable + 1 : 0;
        if (stable >= 2) return `reached end after ${i + 1} scrolls`;
        lastHeight = height;
      }
      return `stopped after ${max} scrolls`;
    }
    if (a.selector) {
      const loc = ctx.locator(a.selector).first();
      if (a.to == null && a.x == null && a.y == null) {
        await loc.scrollIntoViewIfNeeded({ timeout: a.timeout });
        return;
      }
      await loc.evaluate(
        (el, { to, x, y }) => {
          if (to) el.scrollTop = to === 'top' ? 0 : el.scrollHeight;
          else el.scrollBy(x ?? 0, y ?? 0);
        },
        { to: a.to, x: a.x, y: a.y },
      );
      return;
    }
    if (a.to) {
      await ctx.page.evaluate((to) => {
        window.scrollTo(0, to === 'top' ? 0 : document.documentElement.scrollHeight);
      }, a.to);
      return;
    }
    await ctx.page.mouse.wheel(a.x ?? 0, a.y ?? 600);
  },
  async mouse(a, ctx) {
    await ctx.page.mouse.move(a.x, a.y, { steps: 12 });
    if (a.click) await ctx.page.mouse.click(a.x, a.y);
  },
};
