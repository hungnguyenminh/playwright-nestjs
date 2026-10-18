/** Nest errors: `{ message: string | string[], errors?: string[] }`. */
export function apiErrorText(err: unknown): string {
  const data = (err as { data?: any })?.data;
  if (data?.errors?.length) return `${data.message}: ${data.errors.join('; ')}`;
  if (Array.isArray(data?.message)) return data.message.join('; ');
  return data?.message ?? (err as Error)?.message ?? String(err);
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
}

/**
 * Plain signature on purpose: $fetch's own types try to match every URL
 * against Nitro's (empty) server routes and can blow the type checker's
 * stack on template-literal URLs.
 */
type Api = <T = unknown>(url: string, opts?: ApiOptions) => Promise<T>;

export function useApi() {
  const base = useRuntimeConfig().public.apiBase as string;
  const api = $fetch.create({ baseURL: base }) as unknown as Api;
  return {
    api,
    base,
    artifactUrl: (id: string, download = false) =>
      `${base}/artifacts/${id}${download ? '?download=1' : ''}`,
  };
}

/** Runs a request, toasts on failure and returns undefined instead of throwing. */
export async function tryApi<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const res = await fn();
    if (success) ElMessage.success(success);
    return res;
  } catch (err) {
    ElMessage.error({ message: apiErrorText(err), duration: 6000 });
    return undefined;
  }
}
