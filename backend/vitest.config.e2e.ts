import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // Set before any import: ConfigModule loads backend/.env at import time
    // but never overrides variables that already exist, so e2e tests can't
    // touch the real database, storage or saved secrets.
    env: {
      MONGODB_URI: 'mongodb://localhost:27017/browser-automation-test',
      STORAGE_DIR: './storage-test',
      PROFILES_DIR: './profiles-test',
      SETTINGS_SECRET: randomBytes(32).toString('hex'),
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: '',
    },
  },
});
