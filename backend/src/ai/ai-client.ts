import Anthropic from '@anthropic-ai/sdk';

export type AiAuthType = 'apiKey' | 'bearer';
export const AI_EFFORTS = [
  '',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

/** Resolved AI configuration (token in clear text, never sent to the browser). */
export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  authType: AiAuthType;
  token: string;
  model: string;
  /** '' = don't send `effort` (for gateways/models that reject it). */
  effort: AiEffort;
}

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_EFFORT: AiEffort = 'medium';

/** The client for one configuration; base URL may be a gateway/proxy. */
export function buildClient(cfg: AiConfig): Anthropic {
  return new Anthropic({
    apiKey: cfg.authType === 'apiKey' ? cfg.token : null,
    authToken: cfg.authType === 'bearer' ? cfg.token : null,
    baseURL: cfg.baseUrl || undefined,
    maxRetries: 2,
    timeout: 10 * 60_000,
  });
}

export function isOfficialEndpoint(cfg: Pick<AiConfig, 'baseUrl'>): boolean {
  if (!cfg.baseUrl) return true;
  try {
    return new URL(cfg.baseUrl).hostname === 'api.anthropic.com';
  } catch {
    return false;
  }
}

/**
 * Per-request extras. Server-side refusal fallback (`fallbacks: "default"`)
 * only on the official endpoint: gateways may reject the beta parameter.
 * On models without fallback support the request simply runs alone.
 */
export function requestExtras(cfg: AiConfig) {
  const official = isOfficialEndpoint(cfg);
  return {
    ...(official
      ? {
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default' as const,
        }
      : {}),
    ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {}),
  };
}

/** Human-readable reason for an SDK error (status-specific first). */
export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return 'Token không hợp lệ (401). Kiểm tra token và loại token.';
  if (err instanceof Anthropic.PermissionDeniedError)
    return 'Token không có quyền dùng model này (403).';
  if (err instanceof Anthropic.NotFoundError)
    return 'Không tìm thấy model hoặc endpoint (404). Kiểm tra tên model và Base URL.';
  if (err instanceof Anthropic.RateLimitError)
    return 'Bị giới hạn tần suất (429). Thử lại sau ít phút.';
  if (err instanceof Anthropic.BadRequestError)
    return `Yêu cầu không hợp lệ (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError)
    return `Không kết nối được tới Base URL: ${err.message}`;
  if (err instanceof Anthropic.APIError) {
    // Gateways put the useful text in the body: { error: { type, message } }.
    const body = err.error as { error?: { type?: string; message?: string } } | undefined;
    const detail = body?.error?.message ?? err.message;
    if (err.status === 402) return `Tài khoản hết hạn mức / chưa thanh toán (402): ${detail}`;
    return `Lỗi API ${err.status ?? ''}: ${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}
