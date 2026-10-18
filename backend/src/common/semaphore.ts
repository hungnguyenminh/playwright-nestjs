export type Release = () => void;

/**
 * Counting semaphore with FIFO waiters. `acquire` can be aborted while queued,
 * which is how cancelled tasks leave the queue without ever taking a slot.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  get inUse() {
    return this.active;
  }

  get pending() {
    return this.waiters.length;
  }

  acquire(signal?: AbortSignal): Promise<Release> {
    signal?.throwIfAborted();
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    return new Promise<Release>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        this.active++;
        resolve(this.releaser());
      };
      const onAbort = () => {
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(signal!.reason);
      };
      this.waiters.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private releaser(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiters.shift()?.();
    };
  }
}
