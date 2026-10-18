import type { Job, JobPatch, Paged } from '~/types/api';

/** A page of jobs kept in sync with live `job:update` events. */
export function useJobsList(query: () => Record<string, unknown>, path = '/jobs') {
  const { api } = useApi();
  const data = ref<Paged<Job>>({ items: [], total: 0, page: 1, limit: 20 });
  const loading = ref(false);

  async function load() {
    loading.value = true;
    const res = await tryApi(() => api<Paged<Job>>(path, { query: query() }));
    if (res) data.value = res;
    loading.value = false;
  }

  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  useLiveRoom('subscribe:jobs', {});
  useLiveEvent<JobPatch>('job:update', (patch) => {
    const job = data.value.items.find((j) => j._id === patch._id);
    if (job) Object.assign(job, patch);
    const status = query().status as string | undefined;
    const leftFilter = job && patch.status && status && !status.split(',').includes(patch.status);
    if (!job || leftFilter) {
      // New job, or one that no longer matches the status filter: refetch, debounced.
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 500);
    }
  });
  onScopeDispose(() => clearTimeout(reloadTimer));

  watch(query, load, { immediate: true, deep: true });
  return { data, loading, load };
}
