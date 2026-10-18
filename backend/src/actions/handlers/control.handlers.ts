import { BreakSignal, StopSignal } from '../run-context.js';
import { errorMessage, HandlerMap } from './handler.js';

/** Safety net for `while` loops without `times`. */
const DEFAULT_MAX_ITERATIONS = 1000;

export const controlHandlers: HandlerMap = {
  async if(a, ctx, step) {
    if (await ctx.evalCondition(a.condition)) {
      await step.run(a.then, 'then');
      return 'then';
    }
    if (a.else) await step.run(a.else, 'else');
    return 'else';
  },

  async repeat(a, ctx, step) {
    const times = a.times == null ? undefined : Number(a.times);
    const max = Number(a.maxIterations ?? DEFAULT_MAX_ITERATIONS);
    const limit = Math.min(times ?? max, max);
    let i = 0;
    for (; i < limit; i++) {
      if (a.while && !(await ctx.evalCondition(a.while))) break;
      ctx.vars[a.as ?? '$index'] = i;
      try {
        await step.run(a.actions, 'actions');
      } catch (err) {
        if (err instanceof BreakSignal) break;
        throw err;
      }
    }
    return `${i} iterations`;
  },

  async forEach(a, ctx, step) {
    const name = a.as ?? '$item';
    let count: number;
    let enter: (i: number) => void;
    if (a.selector) {
      const all = ctx.locator(a.selector);
      count = await all.count();
      enter = (i) => {
        ctx.scope = all.nth(i);
        ctx.vars[name] = i;
      };
    } else {
      if (!Array.isArray(a.items)) {
        throw new Error('forEach needs `selector` or an array in `items`');
      }
      const items = a.items;
      count = items.length;
      enter = (i) => (ctx.vars[name] = items[i]);
    }
    if (a.limit != null) count = Math.min(count, Number(a.limit));

    const scope = ctx.scope;
    let i = 0;
    try {
      for (; i < count; i++) {
        enter(i);
        ctx.vars.$index = i;
        try {
          await step.run(a.actions, 'actions');
        } catch (err) {
          if (err instanceof BreakSignal) break;
          throw err;
        }
      }
    } finally {
      ctx.scope = scope;
    }
    return `${i}/${count} items`;
  },

  async try(a, ctx, step) {
    try {
      await step.run(a.actions, 'actions');
    } catch (err) {
      if (err instanceof BreakSignal || err instanceof StopSignal) throw err;
      ctx.signal.throwIfAborted();
      ctx.vars.$error = errorMessage(err);
      if (a.catch) await step.run(a.catch, 'catch');
      return `caught: ${ctx.vars.$error}`;
    }
  },

  async break() {
    throw new BreakSignal();
  },
  async stop(a) {
    throw new StopSignal(a.message ?? 'stopped');
  },
};
