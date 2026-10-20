import { ConfigType, registerAs } from '@nestjs/config';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const int = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Chrome profiles hold logged-in sessions, so by default they live outside the
 * project folder: %LOCALAPPDATA%\browser-automation\profiles on Windows,
 * ~/.browser-automation/profiles elsewhere.
 */
const defaultProfilesDir = () =>
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'browser-automation', 'profiles')
    : join(homedir(), '.browser-automation', 'profiles');

export const appConfig = registerAs('app', () => ({
  port: int(process.env.PORT, 3001),
  mongodbUri:
    process.env.MONGODB_URI ?? 'mongodb://localhost:27017/browser-automation',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  headless: process.env.HEADLESS !== 'false',
  maxConcurrency: int(process.env.MAX_CONCURRENCY, 10),
  contextsPerBrowser: int(process.env.CONTEXTS_PER_BROWSER, 8),
  storageDir: resolve(process.env.STORAGE_DIR ?? './storage'),
  profilesDir: resolve(process.env.PROFILES_DIR || defaultProfilesDir()),
  /** Largest media file (image / video for posts) accepted, in MB. */
  mediaMaxMb: int(process.env.MEDIA_MAX_MB, 1024),
}));

export type AppConfig = ConfigType<typeof appConfig>;
