import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Browser, BrowserContext, BrowserContextOptions, chromium } from 'playwright';
import { Semaphore } from '../common/semaphore.js';
import { appConfig, type AppConfig } from '../config/app.config.js';
import { Emulation, toContextOptions } from './emulation.js';

export interface LeaseOptions {
  headless: boolean;
  emulation: Emulation;
  /** Use a persistent Chrome profile (user data dir) instead of a throwaway context. */
  profileId?: string;
  /** Throwaway context only: start with these cookies / localStorage (session-mode profiles). */
  storageState?: BrowserContextOptions['storageState'];
  signal?: AbortSignal;
}

export interface ContextLease {
  context: BrowserContext;
  release(): Promise<void>;
}

interface PooledBrowser {
  browser: Browser;
  headless: boolean;
  contexts: number;
  idleTimer?: NodeJS.Timeout;
}

const IDLE_CLOSE_MS = 30_000;
const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'];

/**
 * Hands out isolated BrowserContexts backed by the locally installed Google
 * Chrome. Throwaway contexts are packed into shared Chrome processes
 * (`contextsPerBrowser` each); persistent profiles get their own process and
 * can only be used by one task at a time. A global semaphore caps how many
 * contexts exist at once.
 */
@Injectable()
export class BrowserPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private readonly slots: Semaphore;
  private readonly browsers: PooledBrowser[] = [];
  private readonly launching = new Map<boolean, Promise<PooledBrowser>>();
  private readonly profileLocks = new Map<string, Semaphore>();
  private readonly persistent = new Set<BrowserContext>();

  constructor(@Inject(appConfig.KEY) private readonly config: AppConfig) {
    this.slots = new Semaphore(config.maxConcurrency);
  }

  stats() {
    return {
      maxConcurrency: this.config.maxConcurrency,
      activeContexts: this.slots.inUse,
      queued: this.slots.pending,
      browsers: this.browsers.length + this.persistent.size,
    };
  }

  async lease(opts: LeaseOptions): Promise<ContextLease> {
    const releaseSlot = await this.slots.acquire(opts.signal);
    try {
      return opts.profileId
        ? await this.leasePersistent(opts, releaseSlot)
        : await this.leaseShared(opts, releaseSlot);
    } catch (err) {
      releaseSlot();
      throw err;
    }
  }

  profileDir(profileId: string) {
    return join(this.config.profilesDir, profileId);
  }

  isProfileInUse(profileId: string) {
    return (this.profileLocks.get(profileId)?.inUse ?? 0) > 0;
  }

  private async leaseShared(
    opts: LeaseOptions,
    releaseSlot: () => void,
  ): Promise<ContextLease> {
    const pooled = await this.pickBrowser(opts.headless);
    let context: BrowserContext;
    try {
      context = await pooled.browser.newContext({
        ...toContextOptions(opts.emulation),
        storageState: opts.storageState,
      });
    } catch (err) {
      this.onContextClosed(pooled);
      throw err;
    }
    return {
      context,
      release: once(async () => {
        await context.close().catch(() => undefined);
        this.onContextClosed(pooled);
        releaseSlot();
      }),
    };
  }

  private async leasePersistent(
    opts: LeaseOptions,
    releaseSlot: () => void,
  ): Promise<ContextLease> {
    const id = opts.profileId!;
    let lock = this.profileLocks.get(id);
    if (!lock) this.profileLocks.set(id, (lock = new Semaphore(1)));
    const unlock = await lock.acquire(opts.signal);
    try {
      const userDataDir = this.profileDir(id);
      await mkdir(userDataDir, { recursive: true });
      const context = await chromium.launchPersistentContext(userDataDir, {
        ...toContextOptions(opts.emulation),
        channel: 'chrome',
        headless: opts.headless,
        args: LAUNCH_ARGS,
      });
      this.persistent.add(context);
      return {
        context,
        release: once(async () => {
          await context.close().catch(() => undefined);
          this.persistent.delete(context);
          unlock();
          releaseSlot();
        }),
      };
    } catch (err) {
      unlock();
      throw err;
    }
  }

  /** Picks the least loaded Chrome with room and reserves a context on it. */
  private async pickBrowser(headless: boolean): Promise<PooledBrowser> {
    for (;;) {
      const best = this.browsers
        .filter((b) => b.headless === headless && b.browser.isConnected())
        .sort((a, b) => a.contexts - b.contexts)[0];
      if (best && best.contexts < this.config.contextsPerBrowser) {
        best.contexts++;
        clearTimeout(best.idleTimer);
        return best;
      }

      // Many tasks can ask at once; share a single in-flight launch per mode,
      // then compete again for its slots (the loser may trigger the next launch).
      let launch = this.launching.get(headless);
      if (!launch) {
        launch = this.launch(headless).finally(() =>
          this.launching.delete(headless),
        );
        this.launching.set(headless, launch);
      }
      await launch;
    }
  }

  private async launch(headless: boolean): Promise<PooledBrowser> {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless,
      args: LAUNCH_ARGS,
    });
    const pooled: PooledBrowser = { browser, headless, contexts: 0 };
    this.browsers.push(pooled);
    browser.on('disconnected', () => {
      clearTimeout(pooled.idleTimer);
      const i = this.browsers.indexOf(pooled);
      if (i >= 0) this.browsers.splice(i, 1);
    });
    this.logger.log(
      `Chrome ${browser.version()} launched (${headless ? 'headless' : 'headed'}), ${this.browsers.length} running`,
    );
    return pooled;
  }

  private onContextClosed(pooled: PooledBrowser) {
    pooled.contexts--;
    if (pooled.contexts > 0) return;
    pooled.idleTimer = setTimeout(() => {
      if (pooled.contexts === 0) void pooled.browser.close();
    }, IDLE_CLOSE_MS);
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      ...[...this.persistent].map((c) => c.close()),
      ...this.browsers.map((b) => b.browser.close()),
    ]);
    this.logger.log('All Chrome instances closed');
  }
}

function once(fn: () => Promise<void>): () => Promise<void> {
  let p: Promise<void> | undefined;
  return () => (p ??= fn());
}
