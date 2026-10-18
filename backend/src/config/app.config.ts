import { ConfigType, registerAs } from '@nestjs/config';
import { resolve } from 'node:path';

const int = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const appConfig = registerAs('app', () => ({
  port: int(process.env.PORT, 3001),
  mongodbUri:
    process.env.MONGODB_URI ?? 'mongodb://localhost:27017/browser-automation',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  headless: process.env.HEADLESS !== 'false',
  maxConcurrency: int(process.env.MAX_CONCURRENCY, 10),
  contextsPerBrowser: int(process.env.CONTEXTS_PER_BROWSER, 8),
  storageDir: resolve(process.env.STORAGE_DIR ?? './storage'),
  profilesDir: resolve(process.env.PROFILES_DIR ?? './profiles'),
}));

export type AppConfig = ConfigType<typeof appConfig>;
