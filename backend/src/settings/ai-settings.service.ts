import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  type AiAuthType,
  type AiConfig,
  type AiEffort,
  buildClient,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  describeAiError,
} from '../ai/ai-client.js';
import { AiSettingsDto } from './ai-settings.dto.js';
import { ensureSettingsSecret, SecretBox } from './secret-box.js';
import { Setting } from './setting.schema.js';

const KEY = 'ai';

/** What is stored in Mongo: the token only ever encrypted. */
interface StoredAi {
  enabled?: boolean;
  baseUrl?: string;
  authType?: AiAuthType;
  tokenSealed?: string;
  tokenHint?: string;
  model?: string;
  effort?: AiEffort;
}

/** Safe to send to the browser. */
export interface PublicAiSettings {
  enabled: boolean;
  baseUrl: string;
  authType: AiAuthType;
  model: string;
  effort: AiEffort;
  hasToken: boolean;
  /** Last 4 characters of the saved token. */
  tokenHint: string;
  /** Where the token comes from: the Settings page, backend/.env, or nowhere. */
  tokenSource: 'settings' | 'env' | 'none';
  configured: boolean;
}

const hint = (token: string) => token.slice(-4);

/**
 * AI connection settings edited from the UI. Values saved there win over
 * backend/.env (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL /
 * AI_MODEL), which win over defaults.
 */
@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);
  private readonly box = new SecretBox(ensureSettingsSecret());

  constructor(
    @InjectModel(Setting.name) private readonly settings: Model<Setting>,
  ) {}

  private async stored(): Promise<StoredAi> {
    const doc = await this.settings.findOne({ key: KEY }).lean();
    return (doc?.value ?? {}) as StoredAi;
  }

  /** Configuration with the token decrypted, for server-side use only. */
  async resolve(): Promise<
    AiConfig & { tokenSource: PublicAiSettings['tokenSource'] }
  > {
    const s = await this.stored();
    let token = '';
    let authType: AiAuthType = s.authType ?? 'apiKey';
    let tokenSource: PublicAiSettings['tokenSource'] = 'none';
    if (s.tokenSealed) {
      try {
        token = this.box.decrypt(s.tokenSealed);
        tokenSource = 'settings';
      } catch {
        this.logger.error(
          'Saved AI token cannot be decrypted (SETTINGS_SECRET changed?). Enter it again in Settings.',
        );
      }
    }
    if (!token && process.env.ANTHROPIC_API_KEY) {
      token = process.env.ANTHROPIC_API_KEY;
      authType = 'apiKey';
      tokenSource = 'env';
    } else if (!token && process.env.ANTHROPIC_AUTH_TOKEN) {
      token = process.env.ANTHROPIC_AUTH_TOKEN;
      authType = 'bearer';
      tokenSource = 'env';
    }
    return {
      enabled: s.enabled ?? true,
      baseUrl: s.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? '',
      authType,
      token,
      model: s.model || process.env.AI_MODEL || DEFAULT_MODEL,
      effort: s.effort ?? DEFAULT_EFFORT,
      tokenSource,
    };
  }

  async getPublic(): Promise<PublicAiSettings> {
    const cfg = await this.resolve();
    return {
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      authType: cfg.authType,
      model: cfg.model,
      effort: cfg.effort,
      hasToken: !!cfg.token,
      tokenHint: cfg.token ? hint(cfg.token) : '',
      tokenSource: cfg.tokenSource,
      configured: cfg.enabled && !!cfg.token && !!cfg.model,
    };
  }

  async update(dto: AiSettingsDto): Promise<PublicAiSettings> {
    const s = await this.stored();
    const next: StoredAi = {
      ...s,
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.baseUrl !== undefined && {
        baseUrl: normalizeBaseUrl(dto.baseUrl),
      }),
      ...(dto.authType !== undefined && { authType: dto.authType }),
      ...(dto.model !== undefined && { model: dto.model.trim() }),
      ...(dto.effort !== undefined && { effort: dto.effort }),
    };
    if (dto.token !== undefined) {
      const token = dto.token.trim();
      next.tokenSealed = token ? this.box.encrypt(token) : undefined;
      next.tokenHint = token ? hint(token) : undefined;
    }
    await this.settings.updateOne(
      { key: KEY },
      { value: next },
      { upsert: true },
    );
    return this.getPublic();
  }

  /**
   * The saved configuration overlaid with unsaved form values, so "Test"
   * and "List models" work before saving. No token given = saved token.
   */
  async withOverrides(dto: AiSettingsDto): Promise<AiConfig> {
    const cfg = await this.resolve();
    return {
      ...cfg,
      ...(dto.baseUrl !== undefined && {
        baseUrl: normalizeBaseUrl(dto.baseUrl),
      }),
      ...(dto.authType !== undefined && { authType: dto.authType }),
      ...(dto.model !== undefined &&
        dto.model.trim() && { model: dto.model.trim() }),
      ...(dto.effort !== undefined && { effort: dto.effort }),
      ...(dto.token?.trim() && { token: dto.token.trim() }),
    };
  }

  /** Sends a tiny request with the given configuration. */
  async test(dto: AiSettingsDto) {
    const cfg = await this.withOverrides(dto);
    if (!cfg.token) throw new BadRequestException('Chưa có token');
    const started = Date.now();
    try {
      const res = await buildClient(cfg).messages.create({
        model: cfg.model,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      });
      const text = res.content
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('')
        .trim();
      return {
        ok: true,
        model: res.model,
        latencyMs: Date.now() - started,
        reply: text.slice(0, 100),
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: describeAiError(err),
      };
    }
  }

  async listModels(dto: AiSettingsDto) {
    const cfg = await this.withOverrides(dto);
    if (!cfg.token) throw new BadRequestException('Chưa có token');
    try {
      const models: { id: string; name: string }[] = [];
      for await (const m of buildClient(cfg).models.list()) {
        models.push({ id: m.id, name: m.display_name });
      }
      return { ok: true, models };
    } catch (err) {
      return { ok: false, models: [], error: describeAiError(err) };
    }
  }
}

/**
 * The SDK appends /v1/messages itself, so a gateway URL pasted with its
 * /v1 suffix (".../v1") is reduced to the host part.
 */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1(\/messages)?$/i, '');
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch {
    throw new BadRequestException('Base URL phải là http(s)://…');
  }
  return trimmed;
}
