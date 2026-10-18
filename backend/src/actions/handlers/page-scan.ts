/**
 * Functions that run inside the page (Page.evaluate) for the "no selector
 * needed" actions: dismissOverlays, searchSite, collect, extractAuto. Each must
 * be self-contained (no imports, no closures over Node values) because
 * Playwright serializes it.
 */

/** Attributes used to hand elements found in the page back to Playwright. */
export const MARK = {
  close: 'data-ba-close',
  overlay: 'data-ba-overlay',
  search: 'data-ba-search',
  submit: 'data-ba-submit',
  more: 'data-ba-more',
} as const;

/**
 * Marks fixed layers that cover a large part of the viewport (popups, promo
 * modals, cookie walls) and the buttons that probably close them.
 * Returns how many overlays and close buttons were found.
 */
export function markOverlays(): { overlays: number; closers: number } {
  const ATTR_OVERLAY = 'data-ba-overlay';
  const ATTR_CLOSE = 'data-ba-close';
  document.querySelectorAll(`[${ATTR_OVERLAY}],[${ATTR_CLOSE}]`).forEach((el) => {
    el.removeAttribute(ATTR_OVERLAY);
    el.removeAttribute(ATTR_CLOSE);
  });
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isLayer = (el: Element) => {
    const st = getComputedStyle(el);
    if (st.position !== 'fixed' && st.position !== 'sticky') return false;
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    const covered = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const big = covered >= vw * vh * 0.35;
    // Cookie / consent bars: wide strips at the top or bottom.
    const bar = r.width >= vw * 0.6 && r.height >= 60 && /cookie|consent|gdpr|privacy|quyền riêng tư/i.test((el as HTMLElement).innerText || el.className.toString());
    return big || bar;
  };
  const layers = new Set<Element>();
  // Probe a few points: whatever sits on top there, climb to its fixed layer.
  for (const [x, y] of [
    [0.5, 0.5],
    [0.25, 0.3],
    [0.75, 0.7],
    [0.5, 0.95],
  ]) {
    let el = document.elementFromPoint(vw * x, vh * y);
    while (el && el !== document.body && el !== document.documentElement) {
      if (isLayer(el)) {
        // Prefer the outermost fixed ancestor (backdrop + dialog wrapper).
        let top = el;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (isLayer(p)) top = p;
        }
        // Some apps render the whole page in a fixed shell: that is not a popup.
        const bodyText = document.body.innerText.length || 1;
        const modalish = !!top.querySelector('[role=dialog], [aria-modal=true]') || /modal|popup|dialog|overlay|backdrop|lightbox|consent|cookie/i.test(`${top.className} ${top.id} ${top.getAttribute('role') ?? ''}`);
        const shell = (top as HTMLElement).innerText.length > bodyText * 0.6;
        if (!/^(header|nav)$/i.test(top.tagName) && (modalish || !shell)) layers.add(top);
        break;
      }
      el = el.parentElement;
    }
  }
  let closers = 0;
  const CLOSE_TEXT = /^(×|✕|✖|x|close|đóng|tắt|bỏ qua|để sau|không,? cảm ơn|no,? thanks|skip|dismiss|chấp nhận|đồng ý|accept( all)?|agree|got it|ok)$/i;
  const CLOSE_ATTR = /close|dismiss|đóng|tắt|btn-x|icon-x|modal-x/i;
  layers.forEach((layer) => {
    layer.setAttribute(ATTR_OVERLAY, '');
    const candidates = [layer, ...layer.querySelectorAll('button, a, [role=button], span, div, i, svg, img')];
    for (const c of candidates.slice(0, 400)) {
      if (c === layer && c.tagName !== 'BUTTON') continue;
      const href = c.tagName === 'A' ? (c.getAttribute('href') ?? '') : '';
      if (href && !href.startsWith('#') && !/^javascript:/i.test(href)) continue;
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height || r.width > 260 || r.height > 120) continue;
      const text = ((c as HTMLElement).innerText ?? '').trim();
      const label = `${c.getAttribute('aria-label') ?? ''} ${c.getAttribute('title') ?? ''} ${c.id} ${typeof c.className === 'string' ? c.className : ''} ${c.getAttribute('alt') ?? ''}`;
      if (CLOSE_TEXT.test(text) || (!text && CLOSE_ATTR.test(label)) || (text.length <= 20 && /close|đóng/i.test(label))) {
        c.setAttribute(ATTR_CLOSE, String(closers++));
        if (closers >= 4) break;
      }
    }
  });
  return { overlays: layers.size, closers };
}

/** Hides marked overlays that are still there and unlocks page scrolling. */
export function hideOverlays(): number {
  const els = document.querySelectorAll('[data-ba-overlay]');
  els.forEach((el) => (el as HTMLElement).style.setProperty('display', 'none', 'important'));
  for (const el of [document.documentElement, document.body]) {
    if (getComputedStyle(el).overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
  }
  return els.length;
}

/**
 * Finds the most likely site search box and marks it (and its submit button).
 * `exclude` skips read-only openers once they have been clicked.
 */
export function markSearchBox(exclude: boolean): { found: boolean; readonly?: boolean; label?: string } {
  const ATTR = 'data-ba-search';
  const ATTR_SUBMIT = 'data-ba-submit';
  document.querySelectorAll(`[${ATTR}],[${ATTR_SUBMIT}]`).forEach((el) => {
    el.removeAttribute(ATTR);
    el.removeAttribute(ATTR_SUBMIT);
  });
  const HINT = /search|tìm|tim|kiếm|kiem|query|keyword|từ khoá|từ khóa|tra cứu/i;
  const NAMES = /^(q|s|k|key|keyword|keywords|query|search|searchterm|search_query|term|text|tu-?khoa)$/i;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 20 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const inputs = [...document.querySelectorAll('input, textarea, [role=searchbox], [role=combobox][contenteditable=true]')].filter((el) => {
    const t = (el as HTMLInputElement).type;
    if (el.tagName === 'INPUT' && !['text', 'search', ''].includes(t)) return false;
    if (exclude && (el as HTMLInputElement).readOnly) return false;
    return visible(el);
  });
  let best: { el: Element; score: number } | undefined;
  for (const el of inputs) {
    const inp = el as HTMLInputElement;
    const attrs = `${inp.placeholder ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.id} ${inp.name ?? ''} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('title') ?? ''}`;
    let score = 0;
    if (inp.type === 'search' || el.getAttribute('role') === 'searchbox') score += 5;
    if (NAMES.test(inp.name ?? '')) score += 4;
    if (HINT.test(attrs)) score += 4;
    const form = el.closest('form');
    if (form && (form.getAttribute('role') === 'search' || HINT.test(form.getAttribute('action') ?? '') || HINT.test(form.className.toString()))) score += 3;
    if (el.closest('[role=search], header, nav, [class*=search], [id*=search], [class*=header]')) score += 2;
    if (/email|password|mật khẩu|phone|điện thoại|name|họ tên|address|địa chỉ|coupon|voucher code/i.test(attrs) && !HINT.test(attrs)) score -= 6;
    const r = el.getBoundingClientRect();
    if (r.top < 250) score += 1;
    if (document.activeElement === el) score += 3;
    if (score > 0 && (!best || score > best.score)) best = { el, score };
  }
  if (!best) return { found: false };
  best.el.setAttribute(ATTR, '');
  const form = best.el.closest('form');
  const submit =
    form?.querySelector('button[type=submit], input[type=submit], button:not([type])') ??
    [...(best.el.parentElement?.parentElement?.querySelectorAll('button, [role=button]') ?? [])].find((b) =>
      HINT.test(`${b.getAttribute('aria-label') ?? ''} ${(b as HTMLElement).innerText ?? ''} ${b.className}`),
    );
  submit?.setAttribute(ATTR_SUBMIT, '');
  const inp = best.el as HTMLInputElement;
  return {
    found: true,
    readonly: !!inp.readOnly,
    label: inp.placeholder || best.el.getAttribute('aria-label') || inp.name || best.el.tagName.toLowerCase(),
  };
}

export interface ListGuess {
  selector: string;
  count: number;
  score: number;
}

/**
 * Finds the main repeated list on the page (products, posts, results…) and
 * returns a CSS selector matching its items, or null.
 */
export function guessList(): ListGuess | null {
  const stableClass = (c: string) =>
    /^[a-zA-Z][\w-]{1,40}$/.test(c) && !/\d{3,}/.test(c) && !/^(css|sc|jsx)-/i.test(c) && !/^x[0-9a-z]{5,}$/.test(c);
  const signature = (el: Element) =>
    el.tagName.toLowerCase() +
    [...el.classList]
      .filter(stableClass)
      .sort()
      .map((c) => `.${CSS.escape(c)}`)
      .join('');
  const stableId = (id: string) => /^[a-zA-Z][\w-]{1,40}$/.test(id) && !/\d{3,}/.test(id) && !(/\d/.test(id) && /_/.test(id));
  /** A selector that matches exactly this element (for the list container). */
  const pathTo = (el: Element): string => {
    const parts: string[] = [];
    let anchored = false;
    for (let cur: Element | null = el; cur && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
      if (stableId(cur.id)) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        anchored = true;
        break;
      }
      const sig = signature(cur);
      const parent: Element | null = cur.parentElement;
      const same = parent ? [...parent.children].filter((c) => signature(c) === sig) : [];
      if (sig.includes('.') && same.length === 1) {
        parts.unshift(sig);
        try {
          if (document.querySelectorAll(parts.join(' > ')).length === 1) {
            anchored = true;
            break;
          }
        } catch {
          /* keep climbing */
        }
        continue;
      }
      const index = parent ? [...parent.children].indexOf(cur) + 1 : 1;
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${index})`);
    }
    if (!anchored) parts.unshift('body');
    return parts.join(' > ');
  };
  const realLink = (a: Element) => {
    const h = a.getAttribute('href') ?? '';
    return h && !h.startsWith('#') && !/^javascript:/i.test(h);
  };
  const skip = (el: Element) => !!el.closest('nav, header, footer, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true]');

  let best: ListGuess | null = null;
  for (const parent of [document.body, ...document.querySelectorAll('body *')]) {
    if (parent.children.length < 2 || skip(parent)) continue;
    const bySig = new Map<string, Element[]>();
    for (const c of parent.children) {
      const sig = signature(c);
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig)!.push(c);
    }
    for (const [sig, items] of bySig) {
      if (items.length < 2) continue;
      let withLink = 0;
      let withImg = 0;
      let withPrice = 0;
      let text = 0;
      let wide = 0;
      for (const it of items.slice(0, 40)) {
        const t = ((it as HTMLElement).innerText ?? '').trim();
        if ((it.tagName === 'A' && realLink(it)) || [...it.querySelectorAll('a[href]')].some(realLink)) withLink++;
        if (it.querySelector('img, picture, [style*="background-image"], video')) withImg++;
        if (/\d[\d.,]*\s?(₫|đ|vnđ|vnd)\b|[$€£₫]\s?\d/i.test(t)) withPrice++;
        text += Math.min(t.length, 400);
        const r = it.getBoundingClientRect();
        if (r.width >= 120 && r.height >= 30) wide++;
      }
      const n = Math.min(items.length, 40);
      if (withLink / n < 0.6 || wide / n < 0.5) continue;
      // Two results only count when both look like cards (image + link), e.g. a short search result.
      if (items.length === 2 && (withImg < 2 || withLink < 2)) continue;
      const avgText = text / n;
      if (avgText < 12) continue;
      // Short-text lists of links are usually menus.
      const score =
        items.length *
        (Math.min(avgText, 160) / 160) *
        (1 + (withImg / n) * 0.8 + (withPrice / n) * 0.8) *
        (sig.includes('.') ? 1 : 0.7) *
        (parent.closest('main, [role=main], #main, #content') ? 1.3 : 1) *
        // Table rows and lists inside an article's text are rarely the page's items.
        (/^(tr|td)$/.test(items[0].tagName.toLowerCase()) ? 0.5 : 1) *
        (parent.closest('article, [itemprop=articleBody]') && !withImg ? 0.5 : 1);
      if (!best || score > best.score) {
        best = { selector: `${pathTo(parent)} > ${sig}`, count: items.length, score: Math.round(score * 10) / 10 };
      }
    }
  }
  return best;
}

export interface FieldSpec {
  selector?: string;
  get?: string;
  multiple?: boolean;
}

/**
 * Reads items (Locator.evaluateAll): with `fields` like the `extract` action,
 * otherwise picks title / url / image / price / time / text automatically.
 */
export function readItems(
  els: Element[],
  opts: { fields: Record<string, FieldSpec> | null; auto: boolean },
): Array<Record<string, unknown>> {
  const { fields } = opts;
  const clean = (s: string | null | undefined, n = 500) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const abs = (u: string | null | undefined) => {
    if (!u || u.startsWith('data:')) return '';
    try {
      const url = new URL(u, location.href);
      // Tracking parameters make the same item look different on every visit.
      for (const k of Array.from(url.searchParams.keys())) {
        if (/^(__cft__|__tn__|utm_|fbclid|gclid|mibextid)/.test(k)) url.searchParams.delete(k);
      }
      if (url.hostname.endsWith('youtube.com')) url.searchParams.delete('pp');
      return url.href;
    } catch {
      return '';
    }
  };
  const read = (el: Element | null, how = 'text'): unknown => {
    if (!el) return null;
    if (how === 'text') return clean((el as HTMLElement).innerText ?? el.textContent, 5000);
    if (how === 'html') return el.innerHTML;
    if (how === 'outerHtml') return el.outerHTML;
    if (how === 'value') return (el as HTMLInputElement).value;
    if (how === 'href') return abs(el.getAttribute('href'));
    if (how === 'src') return abs((el as HTMLImageElement).currentSrc || el.getAttribute('src'));
    if (how.startsWith('attr:')) return el.getAttribute(how.slice(5));
    if (how.startsWith('prop:')) return (el as any)[how.slice(5)] ?? null;
    throw new Error(`Unknown get "${how}"`);
  };
  const imageOf = (root: Element) => {
    for (const img of root.querySelectorAll('img')) {
      const src =
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        img.currentSrc ||
        img.getAttribute('src') ||
        (img.getAttribute('srcset') ?? img.getAttribute('data-srcset') ?? '').split(/\s+/)[0];
      const url = abs(src);
      if (url && !/\.svg(\?|$)|1x1|pixel|blank\.gif|placeholder/i.test(url)) return url;
    }
    const bg = root.querySelector('[style*="background-image"]') as HTMLElement | null;
    const m = bg && /url\(["']?([^"')]+)/.exec(bg.style.backgroundImage);
    return m ? abs(m[1]) : '';
  };
  const auto = (el: Element) => {
    const links = [...(el.tagName === 'A' ? [el] : []), ...el.querySelectorAll('a[href]')].filter((a) => {
      const h = a.getAttribute('href') ?? '';
      return h && !h.startsWith('#') && !/^javascript:/i.test(h);
    });
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [role=heading], [itemprop=name], [class*=title], [class*=name]');
    const textLink = [...links].sort((a, b) => clean((b as HTMLElement).innerText).length - clean((a as HTMLElement).innerText).length)[0];
    const main =
      (heading && (heading.closest('a[href]') ?? heading.querySelector('a[href]'))) ||
      links.find((a) => a.querySelector('img')) ||
      textLink ||
      links[0];
    const img = el.querySelector('img');
    const title =
      clean((heading as HTMLElement | null)?.innerText, 300) ||
      clean(main?.getAttribute('title'), 300) ||
      clean((textLink as HTMLElement | undefined)?.innerText, 300) ||
      clean(img?.getAttribute('alt'), 300);
    const text = clean((el as HTMLElement).innerText, 1000);
    // First amount that is not a discount / deposit ("Giảm 200.000₫", "-10%"…).
    const price =
      [...text.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d+)\s?(₫|đ|vnđ|vnd)(?![a-zà-ỹ])|[$€£₫]\s?\d[\d.,]*/gi)].find(
        (m) => !/(giảm|tiết kiệm|trả trước|tặng|hoàn|off|save|-)\s*(đến|tới|ngay)?\s*$/i.test(text.slice(Math.max(0, m.index - 16), m.index)),
      )?.[0] ?? '';
    const time = el.querySelector('time');
    const item: Record<string, unknown> = { title, url: abs(main?.getAttribute('href')) };
    const image = imageOf(el);
    if (image) item.image = image;
    if (price) item.price = price.replace(/\s+/g, '');
    if (time) item.time = time.getAttribute('datetime') || clean(time.textContent, 60);
    item.text = text;
    return item;
  };
  const pick = (el: Element, sel?: string) => (!sel || sel === ':scope' ? [el] : Array.from(el.querySelectorAll(sel)));
  return els.map((el) => {
    if (!fields) return auto(el);
    const own = Object.fromEntries(
      Object.entries(fields).map(([key, f]) => {
        const found = pick(el, f.selector);
        return [key, f.multiple ? found.map((x) => read(x, f.get)) : read(found[0] ?? null, f.get)];
      }),
    );
    if (!opts.auto) return own;
    const base = auto(el);
    for (const [k, v] of Object.entries(own)) if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) base[k] = v;
    return base;
  });
}

/**
 * Marks a visible "load more" control that does not navigate away
 * ("Xem thêm 20 sản phẩm", "Load more"…). Returns whether one was found.
 */
export function markLoadMore(listSelector: string | null): boolean {
  const ATTR = 'data-ba-more';
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
  const TEXT = /^(xem thêm|tải thêm|hiển thị thêm|load more|show more|more results|view more|see more results|xem tiếp)\b/i;
  let list: Element | null = null;
  try {
    list = listSelector ? document.querySelector(listSelector) : null;
  } catch {
    list = null;
  }
  const near = list?.parentElement?.parentElement?.parentElement ?? document.body;
  const candidates = [...near.querySelectorAll('button, a, [role=button], div[class*=more], span[class*=more]')];
  for (const c of candidates) {
    const t = ((c as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 60 || !TEXT.test(t)) continue;
    if (c.tagName === 'A') {
      const h = c.getAttribute('href') ?? '';
      if (h && !h.startsWith('#') && !/^javascript:/i.test(h)) continue;
    }
    if (c.closest('nav, header, footer')) continue;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    c.setAttribute(ATTR, '');
    return true;
  }
  return false;
}

/** Title, text, date… of an article / product / video page. */
export function readArticle(): Record<string, unknown> {
  const clean = (s: string | null | undefined, n = 500) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v = document.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`)?.getAttribute('content');
      if (v) return clean(v, 1000);
    }
    return '';
  };
  const ld: Array<Record<string, any>> = [];
  const pushLd = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(pushLd);
    if (v['@graph']) pushLd(v['@graph']);
    ld.push(v);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      pushLd(JSON.parse(s.textContent ?? ''));
    } catch {
      /* broken JSON-LD is common */
    }
  });
  const typeOf = (o: Record<string, any>) => [].concat(o['@type'] ?? []).join(',');
  const main =
    ld.find((o) => /Product|Article|BlogPosting|VideoObject|Recipe|Event|JobPosting/.test(typeOf(o))) ?? null;
  const offer = main && [].concat(main.offers ?? [])[0] as Record<string, any> | undefined;
  const name = (v: any) => (typeof v === 'string' ? v : (v?.name ?? [].concat(v ?? []).map((x: any) => x?.name).filter(Boolean).join(', ')));

  // Main text: the block with the most paragraph text.
  let body: Element | null = document.querySelector('[itemprop=articleBody], article, main, [role=main]');
  let bestLen = 0;
  document.querySelectorAll('p').forEach((p) => {
    const parent = p.parentElement;
    if (!parent || parent.closest('nav, header, footer, aside')) return;
    const len = [...parent.querySelectorAll(':scope > p')].reduce((n, x) => n + ((x as HTMLElement).innerText?.length ?? 0), 0);
    if (len > bestLen) {
      bestLen = len;
      if (len > 300) body = parent;
    }
  });
  const time = document.querySelector('time[datetime]');
  const out: Record<string, unknown> = {
    title: clean(main?.name || meta('og:title', 'twitter:title') || document.querySelector('h1')?.textContent || document.title, 300),
    url: document.querySelector('link[rel=canonical]')?.getAttribute('href') || meta('og:url') || location.href,
    description: clean(main?.description || meta('description', 'og:description'), 1000),
    image: [].concat(main?.image ?? [])[0] ? (typeof [].concat(main!.image)[0] === 'string' ? [].concat(main!.image)[0] : ([].concat(main!.image)[0] as any).url) : meta('og:image'),
    publishedAt: main?.datePublished || main?.uploadDate || meta('article:published_time', 'datePublished') || time?.getAttribute('datetime') || '',
    author: clean(name(main?.author) || meta('author', 'article:author'), 200),
  };
  if (offer) {
    out.price = offer.price ?? offer.lowPrice ?? '';
    out.currency = offer.priceCurrency ?? '';
  }
  if (main?.brand) out.brand = name(main.brand);
  if (main?.aggregateRating) {
    out.rating = main.aggregateRating.ratingValue ?? '';
    out.reviews = main.aggregateRating.reviewCount ?? main.aggregateRating.ratingCount ?? '';
  }
  out.text = clean((body as HTMLElement | null)?.innerText ?? document.body.innerText, 8000);
  for (const k of Object.keys(out)) if (out[k] === '' || out[k] == null) delete out[k];
  return out;
}

/** Items of a JSON-LD ItemList (some shops and news sites publish one). */
export function readLdList(): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const visit = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (v['@graph']) visit(v['@graph']);
    if ([].concat(v['@type'] ?? []).includes('ItemList' as never)) {
      for (const el of [].concat(v.itemListElement ?? []) as any[]) {
        const it = el?.item && typeof el.item === 'object' ? el.item : el;
        const url = it?.url ?? el?.url ?? (typeof el?.item === 'string' ? el.item : '');
        if (!url) continue;
        const offer = [].concat(it.offers ?? [])[0] as any;
        const image = [].concat(it.image ?? [])[0] as any;
        items.push({
          title: it.name ?? el.name ?? '',
          url: new URL(url, location.href).href,
          ...(image ? { image: typeof image === 'string' ? image : image.url } : {}),
          ...(offer?.price || offer?.lowPrice ? { price: String(offer.price ?? offer.lowPrice) } : {}),
          ...(it.description ? { text: String(it.description).slice(0, 1000) } : {}),
        });
      }
    }
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      visit(JSON.parse(s.textContent ?? ''));
    } catch {
      /* ignore */
    }
  });
  return items;
}

/**
 * Gets items ready to be read: fires hover events on `hover` elements (some
 * sites, e.g. Facebook, only set a post's real link on mouseover) and clicks
 * "Xem thêm / See more" buttons that expand a truncated text.
 */
export function prepareItems(els: Element[], opts: { hover?: string; expand?: boolean }): number {
  let n = 0;
  for (const el of els) {
    if (el.hasAttribute('data-ba-ready')) continue;
    el.setAttribute('data-ba-ready', '');
    if (opts.hover) {
      el.querySelectorAll(opts.hover).forEach((h) => {
        for (const type of ['mouseover', 'mouseenter', 'mousemove', 'focusin']) {
          h.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'mouseenter', cancelable: true, view: window }));
        }
        n++;
      });
    }
    if (opts.expand) {
      el.querySelectorAll('[role=button], button, span, div').forEach((b) => {
        if (b.children.length > 1) return;
        const t = ((b as HTMLElement).innerText ?? '').trim();
        if (/^(xem thêm|see more|… xem thêm|\.\.\. xem thêm|more)$/i.test(t)) {
          (b as HTMLElement).click();
          n++;
        }
      });
    }
  }
  return n;
}
