/** Nest errors: `{ message: string | string[], errors?: string[] }`. */
export function apiErrorText(err: unknown): string {
  const data = (err as { data?: any })?.data;
  if (data?.errors?.length) return `${data.message}: ${data.errors.join('; ')}`;
  if (Array.isArray(data?.message)) return data.message.join('; ');
  return data?.message ?? (err as Error)?.message ?? String(err);
}

export function useApi() {
  const base = useRuntimeConfig().public.apiBase as string;
  const api = $fetch.create({ baseURL: base });
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
