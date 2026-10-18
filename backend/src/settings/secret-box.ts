import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';

/**
 * AES-256-GCM for secrets stored in MongoDB (API tokens). The key comes from
 * SETTINGS_SECRET (64 hex chars); if it is missing, one is generated and
 * appended to ./.env so stored secrets survive restarts.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(hexKey)) {
      throw new Error('SETTINGS_SECRET must be 64 hex characters');
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  /** Format: v1:<iv>:<tag>:<ciphertext>, all base64. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
      .join(':');
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, data] = sealed.split(':');
    if (version !== 'v1' || !iv || !tag || data === undefined)
      throw new Error('Unknown secret format');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** Reads SETTINGS_SECRET, creating and persisting one on first run. */
export function ensureSettingsSecret(envFile = '.env'): string {
  const existing = process.env.SETTINGS_SECRET;
  if (existing) return existing;
  const key = randomBytes(32).toString('hex');
  const prefix = existsSync(envFile) ? '\n' : '';
  appendFileSync(
    envFile,
    `${prefix}# Encrypts tokens saved from the Settings page. Keep it; changing it makes saved tokens unreadable.\nSETTINGS_SECRET=${key}\n`,
  );
  process.env.SETTINGS_SECRET = key;
  return key;
}
