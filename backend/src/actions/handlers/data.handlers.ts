import { extname } from 'node:path';
import type { ExtractField } from '../action.types.js';
import type { HandlerMap } from './handler.js';

/** A bare function body, or an expression that already is a function. */
const FUNCTION_LIKE =
  /^\s*(async\s+)?(function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;

export function buildEvalSource(script: string, arg: unknown, vars: unknown) {
  const fn = FUNCTION_LIKE.test(script)
    ? script
    : `async (arg, vars) => {\n${script}\n}`;
  return `(${fn})(${JSON.stringify(arg ?? null)}, ${JSON.stringify(vars)})`;
}

export const dataHandlers: HandlerMap = {
  async extract(a, ctx) {
    const fields = a.fields
      ? Object.fromEntries(
          Object.entries(a.fields).map(([k, f]) => [
            k,
            typeof f === 'string' ? ({ selector: f } as ExtractField) : f,
          ]),
        )
      : undefined;
    const base = ctx.locator(a.selector);
    if (!a.multiple && (await base.count()) === 0) {
      throw new Error(`No element matches ${a.selector}`);
    }
    // One round trip for all elements; field selectors are plain CSS.
    const values = await (a.multiple ? base : base.first()).evaluateAll(
      (els, { fields, get }) => {
        const read = (el: Element | null, how = 'text'): unknown => {
          if (!el) return null;
          if (how === 'text') {
            return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
          }
          if (how === 'html') return el.innerHTML;
          if (how === 'outerHtml') return el.outerHTML;
          if (how === 'value') return (el as HTMLInputElement).value;
          if (how.startsWith('attr:')) return el.getAttribute(how.slice(5));
          if (how.startsWith('prop:')) return (el as any)[how.slice(5)] ?? null;
          throw new Error(`Unknown get "${how}"`);
        };
        const pick = (el: Element, sel?: string) =>
          !sel || sel === ':scope' ? [el] : Array.from(el.querySelectorAll(sel));
        return els.map((el) => {
          if (!fields) return read(el, get);
          return Object.fromEntries(
            Object.entries(fields).map(([key, f]) => {
              const found = pick(el, f.selector);
              return [
                key,
                f.multiple
                  ? found.map((x) => read(x, f.get))
                  : read(found[0] ?? null, f.get),
              ];
            }),
          );
        });
      },
      { fields, get: a.get },
    );
    const name = a.as ?? 'data';
    ctx.output(name, a.multiple ? values : values[0]);
    return a.multiple ? `${values.length} items → ${name}` : `→ ${name}`;
  },

  async screenshot(a, ctx) {
    const data = a.selector
      ? await ctx.locator(a.selector).first().screenshot({ timeout: a.timeout })
      : await ctx.page.screenshot({ fullPage: a.fullPage, timeout: a.timeout });
    return ctx.hooks.saveArtifact({
      kind: 'screenshot',
      name: a.name,
      ext: 'png',
      mime: 'image/png',
      data,
    });
  },

  async pdf(a, ctx) {
    const data = await ctx.page.pdf({ printBackground: true });
    return ctx.hooks.saveArtifact({
      kind: 'pdf',
      name: a.name,
      ext: 'pdf',
      mime: 'application/pdf',
      data,
    });
  },

  async download(a, ctx) {
    const [download] = await Promise.all([
      ctx.page.waitForEvent('download', { timeout: a.timeout }),
      ctx.locator(a.selector).first().click({ timeout: a.timeout }),
    ]);
    const filename = download.suggestedFilename();
    const id = await ctx.hooks.saveArtifact({
      kind: 'download',
      name: a.name ?? filename,
      ext: extname(filename).slice(1) || 'bin',
      mime: 'application/octet-stream',
      fromPath: await download.path(),
    });
    if (a.as) ctx.output(a.as, { artifactId: id, filename });
    return `${filename} (${id})`;
  },

  async getCookies(a, ctx) {
    const cookies = await ctx.context.cookies(a.urls);
    ctx.output(a.as ?? 'cookies', cookies);
    return `${cookies.length} cookies`;
  },
  async setCookies(a, ctx) {
    await ctx.context.addCookies(a.cookies as any);
    return `${a.cookies.length} cookies`;
  },
  async clearCookies(_a, ctx) {
    await ctx.context.clearCookies();
  },

  async evaluate(a, ctx) {
    const value = await ctx.root.evaluate(
      buildEvalSource(a.script, a.arg, ctx.vars),
    );
    if (a.as) ctx.output(a.as, value);
    const preview = JSON.stringify(value);
    return preview === undefined ? undefined : preview.slice(0, 200);
  },
  async set(a, ctx) {
    ctx.vars[a.var] = a.value;
    return `${a.var} = ${JSON.stringify(a.value)?.slice(0, 200)}`;
  },
  async log(a) {
    return String(a.message);
  },
};
