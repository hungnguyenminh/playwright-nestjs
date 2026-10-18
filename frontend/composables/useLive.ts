import { io, type Socket } from 'socket.io-client';
import type { MaybeRefOrGetter } from 'vue';
import { useLiveStore } from '~/stores/live';

let socket: Socket | undefined;
/** Active subscriptions (ref-counted), replayed after a reconnect. */
const subs = new Map<string, { count: number; event: string; payload: Record<string, unknown> }>();

export function useSocket(): Socket {
  if (socket) return socket;
  const live = useLiveStore();
  const s = io(`${useRuntimeConfig().public.apiBase}/live`, { transports: ['websocket'] });
  s.on('connect', () => {
    live.connected = true;
    for (const sub of subs.values()) s.emit(sub.event, sub.payload);
  });
  s.on('disconnect', () => (live.connected = false));
  return (socket = s);
}

function unsubscribePayload(event: string, payload: Record<string, unknown>) {
  if (event === 'subscribe:jobs') return { jobs: true };
  if (event === 'subscribe:job') return { jobId: payload.jobId };
  return { taskId: payload.taskId };
}

function subscribe(event: string, payload: Record<string, unknown>) {
  const key = event + JSON.stringify(payload);
  const existing = subs.get(key);
  if (existing) existing.count++;
  else {
    subs.set(key, { count: 1, event, payload });
    useSocket().emit(event, payload);
  }
  return () => {
    const cur = subs.get(key);
    if (!cur || --cur.count > 0) return;
    subs.delete(key);
    const s = useSocket();
    s.emit('unsubscribe', unsubscribePayload(event, payload));
    // Leaving a room drops it for every subscription sharing it (e.g. a grid
    // thumbnail and the task page): re-join whatever is still wanted.
    for (const other of subs.values()) s.emit(other.event, other.payload);
  };
}

/**
 * Holds a room subscription for the lifetime of the calling component and
 * follows a reactive payload (`null` = unsubscribed).
 */
export function useLiveRoom(
  event: 'subscribe:jobs' | 'subscribe:job' | 'subscribe:task',
  payload: MaybeRefOrGetter<Record<string, unknown> | null>,
) {
  let off: (() => void) | undefined;
  const stop = watch(
    () => toValue(payload),
    (p, old) => {
      if (old && p && JSON.stringify(p) === JSON.stringify(old)) return;
      off?.();
      off = p ? subscribe(event, p) : undefined;
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    stop();
    off?.();
  });
}

export function useLiveEvent<T>(event: string, handler: (data: T) => void) {
  const s = useSocket();
  s.on(event, handler);
  onScopeDispose(() => s.off(event, handler));
}
