import type { Page } from 'playwright';
import type { ExtractField } from '../action.types.js';
import type { RunContext } from '../run-context.js';
import { HandlerMap, randomBetween, sleep } from './handler.js';
import {
  FieldSpec,
  guessList,
  hideOverlays,
  markLoadMore,
  markOverlays,
  markSearchBox,
  prepareItems,
  readArticle,
  readItems,
  readLdList,
} from './page-scan.js';

type Item = Record<string, unknown>;

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_SCROLLS = 30;
/** Rounds in a row without new items before giving up on scrolling. */
const STALE_ROUNDS = 3;

/** Closes (or hides) popups and cookie walls covering the page; returns what was done. */
export async function dismissOverlays(page: Page, signal?: AbortSignal): Promise<string> {
  const done: string[] = [];
  for (let round = 0; round < 4; round++) {
    const found = await page.evaluate(markOverlays).catch(() => ({ overlays: 0, closers: 0 }));
    if (!found.overlays) break;
    if (round === 0) {
      await page.keyboard.press('Escape');
      done.push('Esc');
    } else if (round < 3 && found.closers) {
      let clicked = false;
      for (let i = 0; i < found.closers && !clicked; i++) {
        clicked = await page
          .locator(`[data-ba-close="${i}"]`)
          .click({ timeout: 1_500, force: true })
          .then(() => true)
          .catch(() => false);
      }
      if (clicked) done.push('bấm nút đóng');
    } else {
      const n = await page.evaluate(hideOverlays);
      if (n) done.push(`ẩn ${n} lớp phủ`);
      break;
    }
    await sleep(500, signal);
  }
  return done.length ? done.join(', ') : 'không có lớp phủ';
}

/** Merges a fresh read into a known item: fills fields that were empty (lazy images…). */
function mergeInto(target: Item, fresh: Item) {
  for (const [k, v] of Object.entries(fresh)) {
    if ((target[k] === '' || target[k] == null) && v !== '' && v != null) target[k] = v;
  }
}

const keyOf = (item: Item) => {
  for (const f of ['url', 'link', 'href', 'id']) {
    const v = item[f];
    if (typeof v === 'string' && v) return `${f}:${v}`;
  }
  return JSON.stringify(item);
};

function normalizeFields(fields?: Record<string, string | ExtractField>): Record<string, FieldSpec> | null {
  if (!fields) return null;
  return Object.fromEntries(
    Object.entries(fields).map(([k, f]) => [k, typeof f === 'string' ? { selector: f } : f]),
  );
}

/**
 * Reads items matching `selector`, scrolling or pressing "load more" until
 * `limit` distinct items are collected or nothing new shows up.
 */
async function collectItems(
  ctx: RunContext,
  selector: string,
  fields: Record<string, FieldSpec> | null,
  opts: {
    limit: number;
    maxScrolls: number;
    loadMore: boolean | string;
    auto?: boolean;
    required?: string[];
    hover?: string;
    expand?: boolean;
  },
): Promise<Item[]> {
  const page = ctx.page;
  const seen = new Map<string, Item>();
  const required = opts.required ?? [];
  let stale = 0;
  let tryMore = !!opts.loadMore;
  let pressedLast = false;
  for (let round = 0; round <= opts.maxScrolls; round++) {
    ctx.signal.throwIfAborted();
    if (opts.hover || opts.expand) {
      const touched = await ctx.locator(selector).evaluateAll(prepareItems, { hover: opts.hover, expand: opts.expand });
      if (touched) await sleep(500, ctx.signal);
    }
    const batch = await ctx.locator(selector).evaluateAll(readItems, { fields, auto: !!opts.auto });
    let added = 0;
    for (const item of batch) {
      const values = Object.values(item).filter((v) => v !== '' && v != null && !(Array.isArray(v) && !v.length));
      if (!values.length || required.some((f) => item[f] === '' || item[f] == null)) continue;
      const key = keyOf(item);
      const known = seen.get(key);
      if (known) mergeInto(known, item);
      else if (seen.size < opts.limit) {
        seen.set(key, item);
        added++;
      }
    }
    if (seen.size >= opts.limit || round === opts.maxScrolls) break;
    stale = added ? 0 : stale + 1;
    if (stale >= STALE_ROUNDS) break;
    // A "Xem thêm" that adds nothing (it only expands a text): scroll instead from now on.
    if (pressedLast && !added) tryMore = false;

    // Prefer an explicit "load more" control, then fall back to scrolling.
    let pressed = false;
    if (tryMore) {
      const before = page.url();
      const target =
        typeof opts.loadMore === 'string'
          ? ctx.locator(opts.loadMore).first()
          : (await page.evaluate(markLoadMore, selector)) && page.locator('[data-ba-more]').first();
      if (target && (await target.isVisible().catch(() => false))) {
        pressed = await target
          .click({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (pressed && page.url() !== before) {
          await page.goBack().catch(() => undefined);
          pressed = false;
        }
      }
    }
    pressedLast = pressed;
    if (!pressed) {
      await page.mouse.wheel(0, 900).catch(() => undefined);
      await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9))).catch(() => undefined);
    }
    await sleep(randomBetween(1_000, 1_600), ctx.signal);
  }
  return [...seen.values()];
}

/** Opens each item's URL in a background tab and adds what the page says about itself. */
async function addDetails(ctx: RunContext, items: Item[], timeout?: number): Promise<number> {
  let n = 0;
  for (const item of items) {
    ctx.signal.throwIfAborted();
    const url = typeof item.url === 'string' ? item.url : '';
    if (!/^https?:/.test(url)) continue;
    const tab = await ctx.context.newPage();
    try {
      await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: timeout ?? 30_000 });
      await sleep(randomBetween(800, 1_500), ctx.signal);
      const article = await tab.evaluate(readArticle);
      const { text, title: _title, url: _url, ...rest } = article;
      for (const [k, v] of Object.entries(rest)) if (item[k] === undefined || item[k] === '') item[k] = v;
      if (text) item.content = text;
      n++;
    } catch (err) {
      item.detailError = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : String(err);
    } finally {
      await tab.close().catch(() => undefined);
    }
  }
  return n;
}

/** `extra` first so source / keyword columns come first; empty values are left out. */
function withExtra(items: Item[], extra?: Record<string, unknown>): Item[] {
  const fixed = Object.fromEntries(Object.entries(extra ?? {}).filter(([, v]) => v !== '' && v != null));
  return items.map((it) => ({ ...fixed, ...it }));
}

/** Stores the list, or adds it to the one already there (`append`), skipping known urls. */
function store(ctx: RunContext, name: string, items: Item[], append?: boolean): number {
  const prev = append && Array.isArray(ctx.vars[name]) ? (ctx.vars[name] as Item[]) : [];
  const known = new Set(prev.map(keyOf));
  const fresh = items.filter((it) => !known.has(keyOf(it)));
  ctx.output(name, [...prev, ...fresh]);
  return prev.length + fresh.length;
}

export const sourceHandlers: HandlerMap = {
  async dismissOverlays(_a, ctx) {
    return dismissOverlays(ctx.page, ctx.signal);
  },

  async searchSite(a, ctx) {
    const page = ctx.page;
    const query = String(a.query ?? '').trim();
    if (!query) return 'bỏ qua (không có từ khoá)';
    const timeout = a.timeout ?? 15_000;
    let label = a.selector ?? '';
    let box;
    if (a.selector) {
      box = ctx.locator(a.selector).first();
    } else {
      await dismissOverlays(page, ctx.signal);
      let found = await page.evaluate(markSearchBox, false);
      if (!found.found) {
        // Search hidden behind an icon: open it and look again.
        const toggle = page
          .locator('button, a[href="#"], a:not([href]), [role=button]')
          .filter({ has: page.locator('svg, i, img, span') })
          .and(page.locator('[aria-label*="search" i], [aria-label*="tìm" i], [title*="search" i], [title*="tìm" i], [class*="search" i]'))
          .first();
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click({ timeout: 3_000 }).catch(() => undefined);
          await sleep(800, ctx.signal);
          found = await page.evaluate(markSearchBox, true);
        }
      }
      if (!found.found) throw new Error('Không tìm thấy ô tìm kiếm trên trang (thử điền selector của ô search)');
      label = found.label ?? '';
      if (found.readonly) {
        // A read-only box that only opens the real search panel.
        await page.locator('[data-ba-search]').first().click({ timeout, force: true });
        await sleep(1_000, ctx.signal);
        found = await page.evaluate(markSearchBox, true);
        if (!found.found) throw new Error('Đã mở khung tìm kiếm nhưng không thấy ô để gõ');
        label = found.label ?? label;
      }
      box = page.locator('[data-ba-search]').first();
    }

    const before = page.url();
    await box.click({ timeout }).catch(() => box.focus({ timeout }));
    await box.fill('', { timeout }).catch(() => undefined);
    await page.keyboard.type(query, { delay: randomBetween(40, 90) });
    await sleep(randomBetween(300, 600), ctx.signal);
    const moved = page.waitForURL((u) => u.href !== before, { timeout: 8_000 }).then(() => true, () => false);
    await page.keyboard.press('Enter');
    if (!(await moved)) {
      const submit = page.locator('[data-ba-submit]').first();
      if (await submit.isVisible().catch(() => false)) {
        const again = page.waitForURL((u) => u.href !== before, { timeout: 8_000 }).then(() => true, () => false);
        await submit.click({ timeout: 3_000 }).catch(() => undefined);
        await again;
      }
    }
    await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await sleep(randomBetween(800, 1_400), ctx.signal);

    const url = page.url();
    if (a.as) ctx.output(a.as, url);
    // A results URL that contains the query can be reused directly next time.
    const pattern = [encodeURIComponent(query), encodeURIComponent(query).replace(/%20/g, '+'), query]
      .map((q) => (url.includes(q) ? url.replace(q, '{{keyword}}') : ''))
      .find(Boolean);
    return `ô "${label}" → ${pattern ? `mẫu URL ${pattern}` : url}`;
  },

  async collect(a, ctx) {
    const items = await collectItems(ctx, a.selector, normalizeFields(a.fields), {
      limit: a.limit ?? DEFAULT_LIMIT,
      maxScrolls: a.maxScrolls ?? DEFAULT_MAX_SCROLLS,
      loadMore: a.loadMore ?? true,
      auto: a.auto,
      required: a.required,
      hover: a.hover,
      expand: a.expand,
    });
    const details = a.detail ? await addDetails(ctx, items, a.timeout) : 0;
    const name = a.as ?? 'items';
    const total = store(ctx, name, withExtra(items, a.extra), a.append);
    return `${items.length} mục${a.detail ? `, ${details} trang chi tiết` : ''} → ${name}${a.append ? ` (tổng ${total})` : ''}`;
  },

  async extractAuto(a, ctx) {
    const mode = a.mode ?? 'auto';
    const limit = a.limit ?? DEFAULT_LIMIT;
    const name = a.as ?? 'items';
    let items: Item[] = [];
    let how = '';
    if (mode !== 'article') {
      const guess = await ctx.page.evaluate(guessList);
      if (guess) {
        items = await collectItems(ctx, guess.selector, null, {
          limit,
          maxScrolls: a.maxScrolls ?? DEFAULT_MAX_SCROLLS,
          loadMore: true,
        });
        how = `danh sách ${guess.selector}`;
      }
      if (items.length < 3) {
        const ld = (await ctx.page.evaluate(readLdList)).slice(0, limit);
        if (ld.length > items.length) {
          items = ld;
          how = 'JSON-LD ItemList';
        }
      }
      // A list page with nothing on it (e.g. a search without results) is an empty result, not an error.
      if (mode === 'list' && !items.length) how = 'không thấy danh sách nào';
    }
    if (!items.length && mode !== 'list') {
      items = [await ctx.page.evaluate(readArticle)];
      how = 'nội dung trang';
    } else if (a.detail) {
      const n = await addDetails(ctx, items, a.timeout);
      how += `, ${n} trang chi tiết`;
    }
    const total = store(ctx, name, withExtra(items, a.extra), a.append);
    return `${items.length} mục (${how}) → ${name}${a.append ? ` (tổng ${total})` : ''}`;
  },
};
