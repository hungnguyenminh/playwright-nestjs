import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { ActionRunner } from './action-runner.js';
import type { Action } from './action.types.js';
import { ActionError, RunContext, StepLog, StopSignal } from './run-context.js';

const HTML = `
  <h1>Shop</h1>
  <input id="q" />
  <button id="go" onclick="document.querySelector('#out').textContent = 'searched ' + q.value">Go</button>
  <p id="out"></p>
  <ul>
    <li class="item"><a href="/a">Alpha</a><span class="price">10</span></li>
    <li class="item"><a href="/b">Beta</a><span class="price">20</span></li>
    <li class="item"><a href="/c">Gamma</a><span class="price">30</span></li>
  </ul>`;

describe('ActionRunner (real Chrome)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });
  afterAll(() => browser?.close());

  beforeEach(async () => {
    context = await browser.newContext();
    context.setDefaultTimeout(3_000);
    page = await context.newPage();
    await page.setContent(HTML);
  });
  afterEach(() => context.close());

  async function run(actions: Action[], vars: Record<string, unknown> = {}) {
    const logs: StepLog[] = [];
    const ctx = new RunContext(
      context,
      page,
      vars,
      {
        onStep: (l) => logs.push(l),
        saveArtifact: async () => 'artifact-id',
        pause: async () => undefined,
      },
      new AbortController().signal,
    );
    let error: unknown;
    try {
      await new ActionRunner(ctx).run(actions);
    } catch (err) {
      error = err;
    }
    return { ctx, logs, error };
  }

  it('fills, clicks and extracts with variables', async () => {
    const { ctx, error } = await run(
      [
        { type: 'fill', selector: '#q', value: '{{term}}' },
        { type: 'click', selector: '#go' },
        { type: 'extract', selector: '#out', as: 'out' },
        {
          type: 'extract',
          selector: '.item',
          multiple: true,
          fields: { name: 'a', href: { selector: 'a', get: 'attr:href' }, price: '.price' },
          as: 'items',
        },
      ],
      { term: 'laptop' },
    );
    expect(error).toBeUndefined();
    expect(ctx.result.out).toBe('searched laptop');
    expect(ctx.result.items).toEqual([
      { name: 'Alpha', href: '/a', price: '10' },
      { name: 'Beta', href: '/b', price: '20' },
      { name: 'Gamma', href: '/c', price: '30' },
    ]);
  });

  it('scopes selectors inside forEach and supports break / if', async () => {
    const { ctx, logs } = await run([
      { type: 'set', var: 'names', value: [] },
      {
        type: 'forEach',
        selector: '.item',
        actions: [
          { type: 'extract', selector: 'a', as: 'name' },
          {
            type: 'evaluate',
            script: 'return [...vars.names, vars.name]',
            as: 'names',
          },
          { type: 'if', condition: { var: 'name', equals: 'Beta' }, then: [{ type: 'break' }] },
        ],
      },
    ]);
    expect(ctx.result.names).toEqual(['Alpha', 'Beta']);
    expect(logs.find((l) => l.path === '2')?.message).toBe('1/3 items');
    expect(logs.some((l) => l.path === '2.actions.3.then.1')).toBe(true);
  });

  it('reports the failing step path, honours optional and try', async () => {
    const { error, logs, ctx } = await run([
      { type: 'click', selector: '#missing', optional: true, timeout: 300 },
      {
        type: 'try',
        actions: [{ type: 'click', selector: '#nope', timeout: 300 }],
        catch: [{ type: 'set', var: 'recovered', value: true }],
      },
      { type: 'if', condition: { exists: 'h1' }, then: [{ type: 'click', selector: '#gone', timeout: 300 }] },
    ]);
    expect(logs[0].status).toBe('skipped');
    expect(ctx.vars.recovered).toBe(true);
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).path).toBe('3.then.1');
    expect(logs.at(-1)).toMatchObject({ path: '3', status: 'error' });
  });

  it('repeat with a variable count, and stop ends the run', async () => {
    const { ctx, error } = await run(
      [
        { type: 'set', var: 'n', value: 0 },
        {
          type: 'repeat',
          times: '{{count}}' as unknown as number,
          actions: [{ type: 'evaluate', script: 'return vars.n + 1', as: 'n' }],
        },
        { type: 'stop', message: 'enough' },
        { type: 'click', selector: '#never' },
      ],
      { count: 4 },
    );
    expect(ctx.result.n).toBe(4);
    expect(error).toBeInstanceOf(StopSignal);
  });
});

describe('errorMessage', () => {
  it('strips terminal colour codes from Playwright call logs', async () => {
    const { errorMessage } = await import('./handlers/handler.js');
    const msg = errorMessage(new Error('locator.click: Timeout 500ms exceeded.\nCall log:\n\u001b[2m  - waiting for locator(\'#missing\')\u001b[22m\n'));
    expect(msg).toBe("locator.click: Timeout 500ms exceeded. | Call log: | - waiting for locator('#missing')");
  });
});
