import { HandlerMap, matchesUrl, urlMatcher } from './handler.js';

// Routes are registered on the context so they also cover tabs opened later.
export const networkHandlers: HandlerMap = {
  async blockResources(a, ctx) {
    const types = new Set(a.resourceTypes);
    await ctx.context.route('**/*', (route) =>
      types.has(route.request().resourceType())
        ? route.abort()
        : route.fallback(),
    );
    return [...types].join(', ');
  },

  async intercept(a, ctx) {
    await ctx.context.route(urlMatcher(a.url), (route) => {
      if (a.abort) return route.abort();
      if (a.fulfill) return route.fulfill(a.fulfill);
      return route.fallback();
    });
  },

  async captureResponses(a, ctx) {
    // Same array instance in vars and result, filled as responses arrive.
    const list: unknown[] = [];
    ctx.output(a.as, list);
    ctx.context.on('response', (res) => {
      if (!matchesUrl(a.url, res.url())) return;
      const entry: Record<string, unknown> = {
        url: res.url(),
        status: res.status(),
      };
      list.push(entry);
      if (a.json) {
        res
          .json()
          .then((body) => (entry.body = body))
          .catch(() => (entry.body = null));
      }
    });
  },
};
