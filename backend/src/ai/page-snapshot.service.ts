import { ConflictException, Injectable } from '@nestjs/common';
import { BrowserPoolService } from '../browser/browser-pool.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { pageOutline } from './page-outline.js';

export interface PageSnapshot {
  url: string;
  title: string;
  outline: string;
  /** JPEG, base64. */
  screenshot: string;
}

const OUTLINE_MAX_CHARS = 14_000;

/**
 * Opens a page in headless Chrome (optionally with a logged-in profile) so
 * the AI can write selectors against the real DOM instead of guessing.
 */
@Injectable()
export class PageSnapshotService {
  constructor(
    private readonly pool: BrowserPoolService,
    private readonly profiles: ProfilesService,
  ) {}

  async capture(
    url: string,
    profileId?: string,
    signal?: AbortSignal,
  ): Promise<PageSnapshot> {
    const profile = profileId ? await this.profiles.leaseFor(profileId) : undefined;
    // A folder profile can only be open once; fail fast instead of waiting for it.
    if (profile?.profileId && this.pool.isProfileInUse(profile.profileId)) {
      throw new ConflictException(
        'Profile đang được dùng bởi một task khác, chưa đọc trang được',
      );
    }
    const emulation = profileId
      ? await this.profiles.emulationFor(profileId)
      : {};
    const lease = await this.pool.lease({
      headless: true,
      emulation,
      profileId: profile?.profileId,
      storageState: profile?.storageState,
      signal,
    });
    try {
      const page = lease.context.pages()[0] ?? (await lease.context.newPage());
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .waitForLoadState('networkidle', { timeout: 6_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1_500);
      const [outline, shot] = await Promise.all([
        page.evaluate(pageOutline, OUTLINE_MAX_CHARS),
        page.screenshot({ type: 'jpeg', quality: 60 }),
      ]);
      return {
        url: page.url(),
        title: await page.title(),
        outline,
        screenshot: shot.toString('base64'),
      };
    } finally {
      await lease.release();
    }
  }
}
