import { Semaphore } from './semaphore.js';

describe('Semaphore', () => {
  it('limits concurrent holders and hands slots out in FIFO order', async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    await sem.acquire();
    const order: number[] = [];
    const p3 = sem.acquire().then((r) => (order.push(3), r));
    const p4 = sem.acquire().then((r) => (order.push(4), r));
    expect(sem.inUse).toBe(2);
    expect(sem.pending).toBe(2);

    r1();
    r1(); // double release is a no-op
    await p3;
    expect(order).toEqual([3]);
    expect(sem.pending).toBe(1);
    (await p3)();
    await p4;
    expect(order).toEqual([3, 4]);
  });

  it('removes an aborted waiter from the queue', async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    const ac = new AbortController();
    const waiting = sem.acquire(ac.signal);
    ac.abort(new Error('cancelled'));
    await expect(waiting).rejects.toThrow('cancelled');
    expect(sem.pending).toBe(0);
    release();
    expect(sem.inUse).toBe(0);
  });
});
