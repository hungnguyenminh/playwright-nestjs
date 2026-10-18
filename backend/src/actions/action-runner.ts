import type { Action } from './action.types.js';
import { controlHandlers } from './handlers/control.handlers.js';
import { dataHandlers } from './handlers/data.handlers.js';
import { errorMessage, Handler, HandlerMap } from './handlers/handler.js';
import { interactionHandlers } from './handlers/interaction.handlers.js';
import { navigationHandlers } from './handlers/navigation.handlers.js';
import { networkHandlers } from './handlers/network.handlers.js';
import { tabHandlers } from './handlers/tab.handlers.js';
import { waitHandlers } from './handlers/wait.handlers.js';
import { interpolate } from './interpolate.js';
import {
  ActionError,
  BreakSignal,
  RunContext,
  StopSignal,
} from './run-context.js';

export const HANDLERS: HandlerMap = {
  ...navigationHandlers,
  ...interactionHandlers,
  ...waitHandlers,
  ...dataHandlers,
  ...networkHandlers,
  ...tabHandlers,
  ...controlHandlers,
};

const isSignal = (err: unknown) =>
  err instanceof BreakSignal || err instanceof StopSignal;

/**
 * Executes an action list against a RunContext, step by step. Every step is
 * interpolated right before it runs, reported through `hooks.onStep`, and a
 * failure is rethrown as an ActionError carrying the step path (unless the
 * step is `optional`). `break` / `stop` travel up as signals.
 */
export class ActionRunner {
  constructor(
    private readonly ctx: RunContext,
    private readonly handlers: HandlerMap = HANDLERS,
  ) {}

  async run(actions: Action[], parentPath = ''): Promise<void> {
    for (let i = 0; i < actions.length; i++) {
      await this.step(actions[i], parentPath ? `${parentPath}.${i + 1}` : `${i + 1}`);
    }
  }

  private async step(raw: Action, path: string): Promise<void> {
    const { ctx } = this;
    ctx.signal.throwIfAborted();
    if (ctx.pauseRequest) {
      const message = ctx.pauseRequest;
      ctx.pauseRequest = undefined;
      await ctx.hooks.pause(message);
    }
    const action = interpolate(raw, ctx.vars);
    const handler = this.handlers[action.type] as Handler | undefined;
    const started = Date.now();
    const log = (status: 'ok' | 'error' | 'skipped', message?: string) =>
      ctx.hooks.onStep({
        path,
        type: action.type,
        label: action.label,
        status,
        message,
        durationMs: Date.now() - started,
      });

    ctx.hooks.onStepStart?.(path, action);
    try {
      if (!handler) throw new Error(`Unknown action "${action.type}"`);
      const message = await handler(action as never, ctx, {
        path,
        run: (children, key) => this.run(children, `${path}.${key}`),
      });
      log('ok', message ?? undefined);
    } catch (err) {
      if (isSignal(err)) {
        log('ok', (err as Error).message);
        throw err;
      }
      // Cancellation: let it surface as-is, no point logging every frame.
      if (ctx.signal.aborted) throw ctx.signal.reason;
      // A child already logged the real failure; just mark the container.
      const nested = err instanceof ActionError;
      const message = nested
        ? `failed at step ${err.path}`
        : errorMessage(err);
      if (action.optional) {
        log('skipped', `${nested ? message + ': ' + err.message : message} (optional)`);
        return;
      }
      log('error', message);
      throw nested ? err : new ActionError(path, action.type, message);
    }
  }
}
