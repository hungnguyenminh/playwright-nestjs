import { normalizeBaseUrl } from './ai-settings.service.js';

describe('normalizeBaseUrl', () => {
  it('drops a trailing slash and the /v1 or /v1/messages suffix the SDK adds itself', () => {
    expect(normalizeBaseUrl('https://api.stali.vn/v1')).toBe('https://api.stali.vn');
    expect(normalizeBaseUrl(' https://api.stali.vn/v1/ ')).toBe('https://api.stali.vn');
    expect(normalizeBaseUrl('https://gw.example.com/anthropic/v1/messages')).toBe('https://gw.example.com/anthropic');
    expect(normalizeBaseUrl('https://api.anthropic.com/')).toBe('https://api.anthropic.com');
    expect(normalizeBaseUrl('')).toBe('');
  });

  it('rejects non-http URLs', () => {
    expect(() => normalizeBaseUrl('ftp://x')).toThrow();
    expect(() => normalizeBaseUrl('not a url')).toThrow();
  });
});
