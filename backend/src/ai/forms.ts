import type Anthropic from '@anthropic-ai/sdk';
import { validateActions } from '../actions/action-validator.js';
import { parseInputs } from '../common/parse-inputs.js';

export const AI_KINDS = ['script', 'profile', 'job'] as const;
export type AiKind = (typeof AI_KINDS)[number];

/** Existing objects the AI may reference, also used to check its proposal. */
export interface FormContext {
  scripts: Array<{
    _id: string;
    name: string;
    description: string;
    defaultVars: Record<string, unknown>;
    variables: string[];
  }>;
  profiles: Array<{ _id: string; name: string; notes: string; inUse: boolean }>;
}

/** Ready to drop into the page's form, plus what is wrong with it (if anything). */
export interface Proposal {
  kind: AiKind;
  payload: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

const str = (description: string) => ({ type: 'string', description });

/**
 * One strict tool per form. Free-form JSON (actions, variables, emulation) is
 * passed as JSON *strings*: the action DSL is recursive, which strict schemas
 * cannot express, so it is validated server-side with Ajv instead.
 */
export const FORM_TOOLS: Record<AiKind, Anthropic.Beta.BetaTool> = {
  script: {
    name: 'propose_script',
    description:
      'Fill the script editor form. Call exactly once, after the guide text.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'name',
        'description',
        'actions_json',
        'default_vars_json',
        'emulation_json',
      ],
      properties: {
        name: str('Short script name'),
        description: str('One sentence: what the script does'),
        actions_json: str(
          'JSON array of actions (the DSL). Must be valid JSON.',
        ),
        default_vars_json: str(
          'JSON object of default variables used as {{name}} in actions, e.g. {"url": "..."}. "{}" if none.',
        ),
        emulation_json: str(
          'JSON object with emulation settings (locale, timezoneId, viewport…). "{}" if none.',
        ),
      },
    },
  },
  profile: {
    name: 'propose_profile',
    description:
      'Fill the Chrome profile form. Call exactly once, after the guide text.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'name',
        'notes',
        'proxy_server',
        'proxy_username',
        'proxy_password',
        'emulation_json',
      ],
      properties: {
        name: str('Profile name'),
        notes: str('Short note: which account/site this profile is for'),
        proxy_server: str(
          'http://host:port or socks5://host:port, or "" for no proxy',
        ),
        proxy_username: str('"" if none'),
        proxy_password: str('"" if none'),
        emulation_json: str(
          'JSON object: locale, timezoneId, viewport, userAgent, geolocation… "{}" if none.',
        ),
      },
    },
  },
  job: {
    name: 'propose_job',
    description:
      'Fill the New job form. Call exactly once, after the guide text.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'source',
        'script_id',
        'actions_json',
        'name',
        'inputs_csv',
        'vars_json',
        'concurrency',
        'headless',
        'profile_id',
        'max_retries',
        'step_timeout_seconds',
      ],
      properties: {
        source: {
          type: 'string',
          enum: ['script', 'inline'],
          description: 'Run a saved script or inline actions',
        },
        script_id: str('_id of a saved script when source = "script", else ""'),
        actions_json: str(
          'JSON array of actions when source = "inline", else ""',
        ),
        name: str('Job name, "" to use the script name'),
        inputs_csv: str(
          'One task per row: CSV with a header row (columns = variable names), or a JSON array of objects. "" = one task with defaults.',
        ),
        vars_json: str('JSON object of variables shared by all tasks, or ""'),
        concurrency: {
          type: 'integer',
          description: 'Parallel Chrome contexts, 1-50',
        },
        headless: {
          type: 'boolean',
          description: 'false shows the Chrome windows (good for a first run)',
        },
        profile_id: str(
          '_id of a saved profile when the site needs a login, else ""',
        ),
        max_retries: {
          type: 'integer',
          description: 'Automatic retries per failed task, 0-5',
        },
        step_timeout_seconds: {
          type: 'integer',
          description: 'Default timeout per step, 1-600',
        },
      },
    },
  },
};

export const TOOL_KIND: Record<string, AiKind> = Object.fromEntries(
  AI_KINDS.map((k) => [FORM_TOOLS[k].name, k]),
);

function parseJson(
  text: unknown,
  what: string,
  errors: string[],
  fallback: unknown,
): unknown {
  if (typeof text !== 'string' || !text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    errors.push(`${what}: JSON không hợp lệ (${(err as Error).message})`);
    return fallback;
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function objectField(
  text: unknown,
  what: string,
  errors: string[],
): Record<string, unknown> {
  const v = parseJson(text, what, errors, {});
  if (!isPlainObject(v)) {
    errors.push(`${what} phải là một object JSON`);
    return {};
  }
  return v;
}

function actionsField(text: unknown, errors: string[]): unknown[] {
  const actions = parseJson(text, 'actions_json', errors, undefined);
  if (actions === undefined) {
    errors.push('actions_json đang trống');
    return [];
  }
  const problems = validateActions(actions);
  errors.push(...problems.map((p) => `actions${p}`));
  if (Array.isArray(actions) && !actions.length)
    errors.push('actions không được rỗng');
  return Array.isArray(actions) ? actions : [];
}

/** `{{name}}` references in a script, e.g. for checking job inputs. */
export function referencedVariables(actions: unknown): string[] {
  const names = new Set<string>();
  JSON.stringify(actions ?? []).replace(
    /\{\{\s*([A-Za-z_$][\w$]*)/g,
    (_, n: string) => {
      names.add(n);
      return '';
    },
  );
  return [...names];
}

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number.isFinite(Number(n)) ? Math.round(Number(n)) : fallback;
  return Math.min(max, Math.max(min, v));
};

export function checkProposal(
  kind: AiKind,
  input: Record<string, unknown>,
  ctx: FormContext,
): Proposal {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (kind === 'script') {
    const actions = actionsField(input.actions_json, errors);
    const defaultVars = objectField(
      input.default_vars_json,
      'default_vars_json',
      errors,
    );
    const missing = referencedVariables(actions).filter(
      (v) => !(v in defaultVars) && !v.startsWith('$'),
    );
    if (missing.length) {
      warnings.push(
        `Biến chưa có giá trị mặc định (cần truyền qua Inputs): ${missing.join(', ')}`,
      );
    }
    return {
      kind,
      errors,
      warnings,
      payload: {
        name: String(input.name ?? '').trim(),
        description: String(input.description ?? ''),
        actions,
        defaultVars,
        emulation: objectField(input.emulation_json, 'emulation_json', errors),
      },
    };
  }

  if (kind === 'profile') {
    const server = String(input.proxy_server ?? '').trim();
    if (server && !/^(https?|socks[45]?):\/\/[^\s/]+/i.test(server)) {
      errors.push(
        'proxy_server phải có dạng http://host:port hoặc socks5://host:port',
      );
    }
    const name = String(input.name ?? '').trim();
    if (!name) errors.push('name đang trống');
    return {
      kind,
      errors,
      warnings,
      payload: {
        name,
        notes: String(input.notes ?? ''),
        proxy: server
          ? {
              server,
              username: String(input.proxy_username ?? '') || undefined,
              password: String(input.proxy_password ?? '') || undefined,
            }
          : null,
        emulation: objectField(input.emulation_json, 'emulation_json', errors),
      },
    };
  }

  // job
  const source = input.source === 'inline' ? 'inline' : 'script';
  const scriptId = String(input.script_id ?? '');
  const script = ctx.scripts.find((s) => s._id === scriptId);
  let actions: unknown[] = [];
  if (source === 'script' && !script) {
    errors.push(
      scriptId
        ? `Không có script với id ${scriptId}`
        : 'Chưa chọn script (script_id)',
    );
  }
  if (source === 'inline') actions = actionsField(input.actions_json, errors);

  const profileId = String(input.profile_id ?? '');
  const profile = ctx.profiles.find((p) => p._id === profileId);
  if (profileId && !profile)
    errors.push(`Không có profile với id ${profileId}`);
  if (profile?.inUse)
    warnings.push(
      `Profile "${profile.name}" đang được dùng, job sẽ chờ tới khi rảnh`,
    );

  const inputsText = String(input.inputs_csv ?? '').trim();
  let rows: Record<string, unknown>[] = [];
  try {
    rows = parseInputs(inputsText);
  } catch (err) {
    errors.push(`inputs_csv: ${(err as Error).message}`);
  }
  const varsText = String(input.vars_json ?? '').trim();
  const vars = varsText ? objectField(varsText, 'vars_json', errors) : {};

  // Variables the script needs that neither defaults, shared vars nor inputs provide.
  const used =
    source === 'script'
      ? (script?.variables ?? [])
      : referencedVariables(actions);
  const provided = new Set([
    ...Object.keys(script?.defaultVars ?? {}),
    ...Object.keys(vars),
    ...(rows[0] ? Object.keys(rows[0]) : []),
  ]);
  const missing = used.filter((v) => !provided.has(v) && !v.startsWith('$'));
  if (missing.length)
    warnings.push(`Biến chưa được cung cấp: ${missing.join(', ')}`);

  return {
    kind,
    errors,
    warnings,
    payload: {
      source,
      scriptId: source === 'script' ? scriptId : '',
      actions: source === 'inline' ? actions : undefined,
      name: String(input.name ?? ''),
      inputsText,
      taskCount: rows.length || 1,
      varsText: varsText ? JSON.stringify(vars, null, 2) : '',
      concurrency: clamp(input.concurrency, 1, 50, 3),
      headless: input.headless !== false,
      profileId: profile ? profileId : '',
      maxRetries: clamp(input.max_retries, 0, 5, 0),
      stepTimeout: clamp(input.step_timeout_seconds, 1, 600, 30),
    },
  };
}
