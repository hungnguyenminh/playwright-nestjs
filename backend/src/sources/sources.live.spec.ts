import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ActionRunner } from '../actions/action-runner.js';
import { RunContext, StepLog } from '../actions/run-context.js';
import { buildSourceJob, SOURCE_TYPES, SourceType } from './connectors.js';

/**
 * Runs connectors against the real sites, read-only and without login.
 * Opt-in: `LIVE=1 npx vitest run src/sources/sources.live.spec.ts`,
 * pick sources with LIVE_SOURCES=website,google. Results go to the temp dir.
 */
const LIVE = !!process.env.LIVE;
const only = (process.env.LIVE_SOURCES ?? 'website').split(',') as SourceType[];

const SAMPLES: Record<SourceType, { targets: string[]; keywords?: string[] }> = {
  website: { targets: ['https://www.thegioididong.com/'], keywords: process.env.LIVE_KEYWORDS?.split(',') ?? ['tai nghe bluetooth'] },
  google: { targets: ['điện thoại gập 2026'] },
  youtube: { targets: ['review iphone 17'] },
  tiktok: { targets: ['review điện thoại'] },
  threads: { targets: ['iphone'] },
  shopee: { targets: ['ốp lưng iphone'] },
  facebook: { targets: ['https://www.facebook.com/groups/example'] },
};

describe.skipIf(!LIVE)('connectors on live sites', { timeout: 300_000 }, () => {
  for (const type of SOURCE_TYPES.filter((t) => only.includes(t))) {
    it(type, async () => {
      const job = buildSourceJob({ type, ...SAMPLES[type], limit: 20 });
      const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED ? false : true, args: ['--disable-blink-features=AutomationControlled'] });
      const out: unknown[] = [];
      try {
        for (const input of job.inputs) {
          const context = await browser.newContext({ locale: 'vi-VN', viewport: { width: 1366, height: 900 } });
          context.setDefaultTimeout(30_000);
          const logs: StepLog[] = [];
          const ctx = new RunContext(
            context,
            await context.newPage(),
            { ...job.vars, ...input },
            { onStep: (l) => logs.push(l), saveArtifact: async () => 'a', pause: async (m) => console.log('PAUSE', m) },
            new AbortController().signal,
          );
          let error = '';
          await new ActionRunner(ctx).run(job.actions).catch((e) => (error = String(e.message)));
          const items = (ctx.result[type] as unknown[]) ?? [];
          console.log(`\n[${type}] ${input.name}: ${items.length} mục ${error ? `LỖI ${error}` : ''}`);
          logs.forEach((l) => console.log(`  ${l.path} ${l.type} ${l.status} ${l.message ?? ''}`));
          console.log(JSON.stringify(items.slice(0, 3), null, 1).slice(0, 1500));
          out.push({ input, error, items });
          await context.close();
        }
      } finally {
        await browser.close();
        writeFileSync(join(tmpdir(), `live-${type}.json`), JSON.stringify(out, null, 1));
      }
    });
  }
});
