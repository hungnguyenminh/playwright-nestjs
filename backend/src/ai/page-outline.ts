/**
 * Runs inside the page (Page.evaluate): a compact, selector-oriented outline
 * the AI can write scripts against. Must be self-contained (no imports, no
 * closures over Node values) because Playwright serializes it.
 */
export function pageOutline(maxChars: number): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const cssEscape = (s: string) => CSS.escape(s);
  // Generated class names (CSS-in-JS, Facebook's atomic classes…) change between deploys.
  const stableClass = (c: string) =>
    /^[a-zA-Z][\w-]{2,40}$/.test(c) &&
    !/\d{2,}/.test(c) &&
    !/^(css|sc|jsx|x[0-9a-z]{5,})-?/i.test(c) &&
    !/^[a-z]{1,3}\d/.test(c);
  // Ids like "mount_0_0_qM" or ":r12:" are generated per page load.
  const stableId = (id: string) =>
    /^[a-zA-Z][\w-]{1,40}$/.test(id) &&
    !/\d{3,}/.test(id) &&
    !(/\d/.test(id) && /_/.test(id));
  const short = (s: string | null | undefined, n = 60) =>
    (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    const st = getComputedStyle(el);
    return (
      !!r &&
      r.width > 0 &&
      r.height > 0 &&
      st.visibility !== 'hidden' &&
      st.display !== 'none'
    );
  };
  const unique = (sel: string) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };

  /** Most stable selector for an element (not necessarily unique for list items). */
  function selectorFor(el: Element, depth = 0): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'body') return 'body';
    if (stableId(el.id)) return `#${cssEscape(el.id)}`;
    for (const attr of [
      'data-testid',
      'data-test',
      'data-qa',
      'data-cy',
      'name',
      'aria-label',
      'placeholder',
      'data-ad-rendering-role',
    ]) {
      const v = el.getAttribute(attr);
      if (v && v.length <= 60) {
        const sel = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
        if (unique(sel)) return sel;
      }
    }
    const classes = [...el.classList].filter(stableClass);
    if (classes.length) {
      const sel = `${tag}.${classes.slice(0, 2).map(cssEscape).join('.')}`;
      if (unique(sel)) return sel;
    }
    const text = short((el as HTMLElement).innerText, 30);
    if (
      text &&
      (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button')
    ) {
      return `${tag === 'a' ? 'a' : tag === 'button' ? 'button' : '[role=button]'}:has-text("${text.replace(/"/g, '\\"')}")`;
    }
    if (classes.length)
      return `${tag}.${classes.slice(0, 2).map(cssEscape).join('.')}`;
    const parent = el.parentElement;
    if (!parent || parent === document.body || depth >= 3) return tag;
    const same = [...parent.children].filter((c) => c.tagName === el.tagName);
    const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : '';
    return `${selectorFor(parent, depth + 1)} > ${tag}${nth}`;
  }

  /** Class-based signature shared by repeated siblings. */
  const signature = (el: Element) =>
    `${el.tagName.toLowerCase()}${[...el.classList]
      .filter(stableClass)
      .sort()
      .map((c) => `.${cssEscape(c)}`)
      .join('')}`;

  const push = (line: string) => {
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  };

  out.push(`URL: ${location.href}`, `Title: ${document.title}`);

  out.push('', '## Headings');
  document.querySelectorAll('h1, h2, h3').forEach((h, i) => {
    if (i < 15 && visible(h))
      push(
        `${h.tagName.toLowerCase()} "${short((h as HTMLElement).innerText)}" → ${selectorFor(h)}`,
      );
  });

  out.push('', '## Inputs and buttons');
  let controls = 0;
  document
    .querySelectorAll(
      'input:not([type=hidden]), textarea, select, button, [role=button], [contenteditable=true], [role=textbox]',
    )
    .forEach((el) => {
      if (controls >= 50 || !visible(el)) return;
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        (el as HTMLInputElement).labels?.[0]?.innerText ||
        short((el as HTMLElement).innerText, 40) ||
        el.getAttribute('name') ||
        el.getAttribute('type') ||
        '';
      const kind =
        el.tagName === 'INPUT'
          ? `input[type=${(el as HTMLInputElement).type}]`
          : (el.getAttribute('role') ?? el.tagName.toLowerCase());
      push(`${kind} "${short(label, 40)}" → ${selectorFor(el)}`);
      controls++;
    });

  // Repeated item groups: >= 3 siblings with the same signature and some text.
  out.push('', '## Repeated lists (item selector, count, sample fields)');
  const groups = new Map<string, { parent: Element; items: Element[] }>();
  [document.body, ...document.querySelectorAll('body *')].forEach((parent) => {
    if (parent.children.length < 3) return;
    const bySig = new Map<string, Element[]>();
    for (const c of parent.children) {
      const sig = signature(c);
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig)!.push(c);
    }
    for (const [sig, items] of bySig) {
      if (
        items.length < 3 ||
        (!sig.includes('.') && !items[0].getAttribute('role'))
      )
        continue;
      const text = items
        .slice(0, 3)
        .map((i) => short((i as HTMLElement).innerText, 200))
        .join('');
      if (text.length < 20) continue;
      const key = `${selectorFor(parent)} > ${sig}`;
      if (!groups.has(key)) groups.set(key, { parent, items });
    }
  });
  [...groups.entries()]
    .sort((a, b) => b[1].items.length - a[1].items.length)
    .slice(0, 8)
    .forEach(([key, { items }]) => {
      const first = items[0];
      const fields: string[] = [];
      first.querySelectorAll('*').forEach((c) => {
        if (fields.length >= 8 || c.children.length > 0) return;
        const t = short((c as HTMLElement).innerText, 40);
        const sig = signature(c);
        if (t && sig.includes('.')) fields.push(`${sig} "${t}"`);
        else if (c.tagName === 'A' && (c as HTMLAnchorElement).href)
          fields.push(
            `a[href] "${short((c as HTMLAnchorElement).getAttribute('href'), 50)}"`,
          );
        else if (c.tagName === 'IMG') fields.push('img[src]');
      });
      push(
        `${key}  ×${items.length}  fields: ${[...new Set(fields)].join(' | ') || '(text) ' + short((first as HTMLElement).innerText, 80)}`,
      );
    });

  // Attributes that usually make the best selectors on modern apps.
  out.push('', '## Notable attributes (count, sample values)');
  for (const attr of [
    'role',
    'aria-posinset',
    'data-testid',
    'data-test',
    'data-qa',
    'data-ad-rendering-role',
    'data-pagelet',
    'itemprop',
    'data-id',
  ]) {
    const els = document.querySelectorAll(`[${attr}]`);
    if (!els.length) continue;
    const values = new Map<string, number>();
    els.forEach((e) => {
      const v = short(e.getAttribute(attr), 30);
      values.set(v, (values.get(v) ?? 0) + 1);
    });
    const top = [...values.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([v, n]) => `${v}×${n}`);
    push(`[${attr}] ×${els.length}: ${top.join(', ')}`);
  }

  out.push('', '## Links (first 30)');
  let links = 0;
  document.querySelectorAll('a[href]').forEach((a) => {
    if (links >= 30 || !visible(a)) return;
    const t = short((a as HTMLElement).innerText, 40);
    if (!t) return;
    push(`"${t}" → ${short(a.getAttribute('href'), 80)}`);
    links++;
  });

  out.push('', '## Visible text (start)');
  out.push(short(document.body?.innerText, 1500));

  const text = out.join('\n');
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n…(truncated)`
    : text;
}
