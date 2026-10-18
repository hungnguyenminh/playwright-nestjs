import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32).toString('hex'));

  it('round-trips and never stores the plain text', () => {
    const sealed = box.encrypt('sk-ant-secret-123');
    expect(sealed).not.toContain('secret');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(box.decrypt(sealed)).toBe('sk-ant-secret-123');
    expect(box.encrypt('same')).not.toBe(box.encrypt('same')); // random IV
  });

  it('rejects tampered data and a different key', () => {
    const sealed = box.encrypt('token');
    const [v, iv, tag, data] = sealed.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() =>
      box.decrypt([v, iv, tag, flipped.toString('base64')].join(':')),
    ).toThrow();
    expect(() =>
      new SecretBox(randomBytes(32).toString('hex')).decrypt(sealed),
    ).toThrow();
  });

  it('requires a 256-bit hex key', () => {
    expect(() => new SecretBox('short')).toThrow(/64 hex/);
  });
});
