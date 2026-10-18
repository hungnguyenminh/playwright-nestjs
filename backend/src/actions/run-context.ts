import type {
  BrowserContext,
  Dialog,
  Frame,
  Locator,
  Page,
} from 'playwright';
import type { Action, Condition } from './action.types.js';
import { interpolate, lookup } from './interpolate.js';

export type StepStatus = 'ok' | 'error' | 'skipped';

export interface StepLog {
  /** 1-based position, nested like "3.then.1" or "4.actions.2". */
  path: string;
  type: string;
  label?: string;
  status: StepStatus;
  message?: string;
  durationMs: number;
}

export type ArtifactKind = 'screenshot' | 'pdf' | 'download';

export interface SaveArtifactInput {
  kind: ArtifactKind;
  name?: string;
  ext: string;
  mime: string;
  data?: Buffer;
  /** Move an existing temp file (downloads) instead of writing `data`. */
  fromPath?: string;
}

/** Side effects the runner needs from whoever owns the task. */
export interface RunHooks {
  onStepStart?(path: string, action: Action): void;
  onStep(log: StepLog): void;
  onPageChange?(page: Page): void;
  saveArtifact(input: SaveArtifactInput): Promise<string>;
  /** Resolves when the user resumes the task from the UI. */
  pause(message?: string): Promise<void>;
}

/** Thrown by `break`; caught by the innermost loop. */
export class BreakSignal extends Error {
  constructor() {
    super('break');
  }
}

/** Thrown by `stop`; ends the task successfully. */
export class StopSignal extends Error {}

export class ActionError extends Error {
  constructor(
    readonly path: string,
    readonly actionType: string,
    message: string,
  ) {
    super(message);
  }
}

/** Mutable state shared by every step of one task run. */
export class RunContext {
  page: Page;
  /** Where selectors resolve: the page, or an iframe inside `frame` actions. */
  root: Page | Frame;
  /** Current element inside `forEach selector`, selectors are relative to it. */
  scope?: Locator;
  readonly result: Record<string, unknown> = {};
  dialogPolicy: { accept: boolean; promptText?: string } = { accept: false };
  /** Set from the UI; the runner pauses before the next step with this message. */
  pauseRequest?: string;

  constructor(
    readonly context: BrowserContext,
    page: Page,
    readonly vars: Record<string, unknown>,
    readonly hooks: RunHooks,
    readonly signal: AbortSignal,
  ) {
    this.page = this.root = page;
    const watch = (p: Page) => p.on('dialog', (d) => void this.onDialog(d));
    context.pages().forEach(watch);
    context.on('page', watch);
  }

  setPage(page: Page) {
    this.page = this.root = page;
    this.scope = undefined;
    this.hooks.onPageChange?.(page);
  }

  locator(selector: string): Locator {
    if (this.scope) {
      return selector === ':scope' ? this.scope : this.scope.locator(selector);
    }
    return this.root.locator(selector);
  }

  /** Stores a named output: visible to later steps and saved as task result. */
  output(name: string, value: unknown) {
    this.vars[name] = value;
    this.result[name] = value;
  }

  async evalCondition(raw: Condition): Promise<boolean> {
    const c = interpolate(raw, this.vars) as Record<string, any>;
    if ('not' in c) return !(await this.evalCondition(c.not));
    if ('all' in c) {
      for (const sub of c.all) if (!(await this.evalCondition(sub))) return false;
      return true;
    }
    if ('any' in c) {
      for (const sub of c.any) if (await this.evalCondition(sub)) return true;
      return false;
    }
    if ('exists' in c) return (await this.locator(c.exists).count()) > 0;
    if ('visible' in c) return this.locator(c.visible).first().isVisible();
    if ('urlIncludes' in c) return this.page.url().includes(c.urlIncludes);
    if ('textIncludes' in c) {
      const { selector, text } = c.textIncludes;
      const content = await this.locator(selector ?? 'body')
        .first()
        .innerText({ timeout: 2_000 })
        .catch(() => '');
      return content.includes(text);
    }
    if ('var' in c) {
      const v = lookup(this.vars, c.var);
      if ('equals' in c) return JSON.stringify(v) === JSON.stringify(c.equals);
      return Array.isArray(v) ? v.length > 0 : Boolean(v);
    }
    if ('js' in c) {
      return Boolean(
        await this.root.evaluate(
          `(async (vars) => (${c.js}))(${JSON.stringify(this.vars)})`,
        ),
      );
    }
    throw new Error(`Unknown condition ${JSON.stringify(raw)}`);
  }

  private async onDialog(dialog: Dialog) {
    const { accept, promptText } = this.dialogPolicy;
    await (accept ? dialog.accept(promptText) : dialog.dismiss()).catch(
      () => undefined,
    );
  }
}
