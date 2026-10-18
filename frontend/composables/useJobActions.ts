import type { Job } from '~/types/api';

export function useJobActions(onChange?: () => void) {
  const { api } = useApi();

  async function cancel(job: Pick<Job, '_id'>) {
    await tryApi(() => api(`/jobs/${job._id}/cancel`, { method: 'POST' }), 'Cancelling…');
  }

  /** `useLatestScript`: re-run with the script's current actions (after fixing it). */
  async function retry(job: Pick<Job, '_id'>, useLatestScript = false) {
    const res = await tryApi(() =>
      api<{ requeued: number }>(`/jobs/${job._id}/retry`, { method: 'POST', body: { useLatestScript } }),
    );
    if (res) ElMessage.success(`Re-queued ${res.requeued} task(s)`);
    onChange?.();
  }

  async function remove(job: Pick<Job, '_id' | 'name'>) {
    const ok = await ElMessageBox.confirm(
      `Delete job "${job.name}" with its tasks, logs and files?`,
      'Delete job',
      { type: 'warning', confirmButtonText: 'Delete' },
    ).catch(() => false);
    if (!ok) return false;
    const res = await tryApi(() => api(`/jobs/${job._id}`, { method: 'DELETE' }).then(() => true), 'Deleted');
    onChange?.();
    return !!res;
  }

  return { cancel, retry, remove };
}
