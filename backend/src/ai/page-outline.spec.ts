import { Browser, chromium } from 'playwright';
import { pageOutline } from './page-outline.js';

const HTML = `
<h1>Shop</h1>
<form><input name="q" placeholder="Tìm sản phẩm"><button type="submit">Tìm</button></form>
<ul class="products">
  ${[1, 2, 3, 4]
    .map(
      (i) =>
        `<li class="product x1lliihq"><a class="title" href="/p/${i}">Sản phẩm ${i} rất tốt</a><span class="price">${i}00.000đ</span></li>`,
    )
    .join('')}
</ul>
<div role="feed"><div aria-posinset="1">a</div><div aria-posinset="2">b</div></div>`;

describe('pageOutline (real Chrome)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });
  afterAll(() => browser?.close());

  it('lists controls, repeated items with stable selectors, and notable attributes', async () => {
    const page = await browser.newPage();
    await page.setContent(HTML);
    const outline = await page.evaluate(pageOutline, 10_000);
    expect(outline).toContain('h1 "Shop"');
    expect(outline).toMatch(
      /input\[type=text\] "Tìm sản phẩm" → input\[name="q"\]/,
    );
    expect(outline).toMatch(/button "Tìm"/);
    // generated class x1lliihq is ignored, stable "product" kept
    expect(outline).toMatch(
      /li\.product\s+×4\s+fields: .*a\.title "Sản phẩm 1 rất tốt".*span\.price "100\.000đ"/,
    );
    expect(outline).not.toContain('x1lliihq');
    expect(outline).toMatch(/\[aria-posinset\] ×2/);
    expect(outline).toMatch(/\[role\] ×1: feed×1/);
  });

  it('truncates to the size limit', async () => {
    const page = await browser.newPage();
    await page.setContent(`<p>${'lorem ipsum '.repeat(2000)}</p>`);
    const outline = await page.evaluate(pageOutline, 500);
    expect(outline.length).toBeLessThan(600);
    expect(outline).toContain('(truncated)');
  });
});
