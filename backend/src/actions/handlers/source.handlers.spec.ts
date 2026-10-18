import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { ActionRunner } from '../action-runner.js';
import type { Action } from '../action.types.js';
import { RunContext, StepLog } from '../run-context.js';

const ORIGIN = 'http://shop.test';

const product = (i: number) => `
  <div class="product-card">
    <a class="thumb" href="/p/${i}"><img data-src="/img/${i}.jpg" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>
    <h3 class="name"><a href="/p/${i}">Điện thoại số ${i}</a></h3>
    <strong class="price">${i}.990.000₫</strong>
  </div>`;

/** Home: promo popup over the page, a read-only box that opens the real search panel. */
const HOME = `<!doctype html><html><body>
  <header>
    <a href="/">Logo</a>
    <input readonly aria-label="Tìm kiếm sản phẩm" onclick="document.querySelector('#panel').style.display='block'; document.querySelector('#real').focus()">
    <nav><a href="/a">Điện thoại</a><a href="/b">Laptop</a><a href="/c">Phụ kiện</a><a href="/d">Đồng hồ</a></nav>
  </header>
  <div id="panel" style="display:none; position:fixed; inset:0; background:#fff; z-index:50">
    <form action="/tim-kiem"><input id="real" name="key" placeholder="Bạn tìm gì..."></form>
  </div>
  <main><h2>Nổi bật</h2><section class="list">${[1, 2, 3, 4].map(product).join('')}</section></main>
  <div class="promo-wrap" style="position:fixed; inset:0; z-index:9998">
    <div style="position:absolute; inset:0; background:#000; opacity:.5"></div>
    <div class="promo" style="position:absolute; top:30%; left:30%; width:300px; height:200px; background:#fff">
      Mã giảm 500.000đ <span class="close-btn" style="display:inline-block; width:20px; height:20px" onclick="this.closest('.promo-wrap').remove()">✕</span>
    </div>
  </div>
</body></html>`;

/** Results: 6 items, "Xem thêm" appends 6 more (18 in total). */
const RESULTS = (q: string) => `<!doctype html><html><body>
  <h1>Kết quả cho "${q}"</h1>
  <ul class="listproduct">${[1, 2, 3, 4, 5, 6].map((i) => `<li class="item">${product(i)}</li>`).join('')}</ul>
  <button class="view-more" onclick="
    const ul = document.querySelector('.listproduct'); const n = ul.children.length;
    for (let i = n + 1; i <= n + 6; i++) ul.insertAdjacentHTML('beforeend', '<li class=&quot;item&quot;><div class=&quot;product-card&quot;><h3 class=&quot;name&quot;><a href=&quot;/p/' + i + '&quot;>Điện thoại số ' + i + '</a></h3><strong class=&quot;price&quot;>' + i + '.990.000₫</strong></div></li>');
    if (ul.children.length >= 18) this.remove();
  ">Xem thêm 6 sản phẩm</button>
</body></html>`;

const DETAIL = (i: number) => `<!doctype html><html><head>
  <meta name="description" content="Mô tả sản phẩm ${i}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Điện thoại số ${i}","brand":{"@type":"Brand","name":"ACME"},
    "offers":{"@type":"Offer","price":"${i}990000","priceCurrency":"VND"},"aggregateRating":{"ratingValue":4.5,"reviewCount":12}}</script>
</head><body><h1>Điện thoại số ${i}</h1><article><p>${'Thông số chi tiết. '.repeat(30)}</p><p>${'Bảo hành 12 tháng. '.repeat(10)}</p></article></body></html>`;

const ARTICLE = `<!doctype html><html><head><meta property="og:title" content="Tin công nghệ"><meta property="article:published_time" content="2026-10-01T08:00:00Z"></head>
  <body><nav><a href="/1">Một</a><a href="/2">Hai</a><a href="/3">Ba</a></nav>
  <h1>Tin công nghệ</h1><div class="content"><p>${'Đoạn văn dài nói về điện thoại. '.repeat(20)}</p><p>${'Thêm nội dung. '.repeat(10)}</p></div></body></html>`;

describe('source actions (real Chrome, fake site)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });
  afterAll(() => browser?.close());

  beforeEach(async () => {
    context = await browser.newContext();
    context.setDefaultTimeout(5_000);
    await context.route(`${ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url());
      const html = (body: string) => route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      if (url.pathname === '/') return html(HOME);
      if (url.pathname === '/tim-kiem') return html(RESULTS(url.searchParams.get('key') ?? ''));
      if (url.pathname.startsWith('/p/')) return html(DETAIL(Number(url.pathname.slice(3))));
      if (url.pathname === '/tin') return html(ARTICLE);
      return route.fulfill({ status: 404, body: '' });
    });
    page = await context.newPage();
  });
  afterEach(() => context.close());

  async function run(actions: Action[], vars: Record<string, unknown> = {}) {
    const logs: StepLog[] = [];
    const ctx = new RunContext(
      context,
      page,
      vars,
      { onStep: (l) => logs.push(l), saveArtifact: async () => 'a', pause: async () => undefined },
      new AbortController().signal,
    );
    await new ActionRunner(ctx).run(actions);
    return { ctx, logs };
  }

  it('closes a covering promo popup', async () => {
    const { logs } = await run([{ type: 'goto', url: `${ORIGIN}/` }, { type: 'dismissOverlays' }]);
    expect(await page.locator('.promo-wrap').count()).toBe(0);
    expect(logs[1].message).toContain('bấm nút đóng');
  });

  it('searches through a read-only opener and collects results past "Xem thêm"', async () => {
    const { ctx, logs } = await run(
      [
        { type: 'goto', url: `${ORIGIN}/` },
        { type: 'searchSite', query: '{{keyword}}' },
        { type: 'extractAuto', limit: 15, maxScrolls: 5, extra: { source: 'website', keyword: '{{keyword}}' }, as: 'website' },
      ],
      { keyword: 'iphone 15' },
    );
    expect(page.url()).toBe(`${ORIGIN}/tim-kiem?key=iphone+15`);
    expect(logs[1].message).toContain('mẫu URL http://shop.test/tim-kiem?key={{keyword}}');
    const items = ctx.result.website as Array<Record<string, unknown>>;
    expect(items).toHaveLength(15);
    expect(items[0]).toMatchObject({
      source: 'website',
      keyword: 'iphone 15',
      title: 'Điện thoại số 1',
      url: `${ORIGIN}/p/1`,
      image: `${ORIGIN}/img/1.jpg`,
      price: '1.990.000₫',
    });
    expect(new Set(items.map((i) => i.url)).size).toBe(15);
  });

  it('reads the list of a link without keyword, with detail pages', async () => {
    const { ctx } = await run([
      { type: 'goto', url: `${ORIGIN}/` },
      { type: 'dismissOverlays' },
      { type: 'searchSite', query: '' },
      { type: 'extractAuto', limit: 2, detail: true, extra: { keyword: '' } },
    ]);
    const items = ctx.result.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).not.toHaveProperty('keyword');
    expect(items[0]).toMatchObject({
      title: 'Điện thoại số 1',
      description: 'Mô tả sản phẩm 1',
      brand: 'ACME',
      price: '1.990.000₫',
      rating: 4.5,
    });
    expect(String(items[0].content)).toContain('Thông số chi tiết');
  });

  it('falls back to the article when the page has no list', async () => {
    const { ctx } = await run([
      { type: 'goto', url: `${ORIGIN}/tin` },
      { type: 'extractAuto', as: 'bai' },
    ]);
    const [a] = ctx.result.bai as Array<Record<string, unknown>>;
    expect(a).toMatchObject({ title: 'Tin công nghệ', publishedAt: '2026-10-01T08:00:00Z', url: `${ORIGIN}/tin` });
    expect(String(a.text)).toContain('Đoạn văn dài');
  });

  it('collect with fields scrolls until the limit and adds extra fields', async () => {
    await page.route(`${ORIGIN}/feed`, (r) =>
      r.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<body><div id="feed"></div><script>
          let n = 0; const add = () => { for (let k = 0; k < 5; k++) { n++; feed.insertAdjacentHTML('beforeend', '<div class="post" style="height:300px"><a href="/post/' + n + '">Bài ' + n + '</a></div>'); } };
          add(); addEventListener('scroll', () => { if (innerHeight + scrollY >= document.body.scrollHeight - 50 && n < 40) add(); });
        </script></body>`,
      }),
    );
    const { ctx } = await run([
      { type: 'goto', url: `${ORIGIN}/feed` },
      { type: 'collect', selector: '.post', fields: { title: 'a', url: { selector: 'a', get: 'href' } }, limit: 12, loadMore: false, extra: { group: 'G' }, as: 'posts' },
    ]);
    const posts = ctx.result.posts as Array<Record<string, unknown>>;
    expect(posts).toHaveLength(12);
    expect(posts[11]).toEqual({ group: 'G', title: 'Bài 12', url: `${ORIGIN}/post/12` });
  });
});
