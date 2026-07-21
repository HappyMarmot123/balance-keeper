// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createLocalCoalescer } from '../../../src/server/resilience';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe('createLocalCoalescer', () => {
  it('shares one acquisition between concurrent callers for the same key', async () => {
    const coalescer = createLocalCoalescer();
    const acquisition = deferred<string>();
    let calls = 0;
    const acquire = () => {
      calls += 1;
      return acquisition.promise;
    };

    const first = coalescer.run('weather:seoul', acquire);
    const second = coalescer.run('weather:seoul', acquire);

    expect(first).toBe(second);
    await Promise.resolve();
    expect(calls).toBe(1);

    acquisition.resolve('sunny');
    await expect(Promise.all([first, second])).resolves.toEqual(['sunny', 'sunny']);
  });

  it('removes a rejected acquisition so a later caller can retry', async () => {
    const coalescer = createLocalCoalescer();
    const failure = new Error('temporary failure');
    let calls = 0;
    const acquire = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(failure) : Promise.resolve('recovered');
    };

    await expect(coalescer.run('earthquake', acquire)).rejects.toBe(failure);
    await expect(coalescer.run('earthquake', acquire)).resolves.toBe('recovered');
    expect(calls).toBe(2);
  });

  it('rejects only the aborted waiter with the original reason', async () => {
    const coalescer = createLocalCoalescer();
    const acquisition = deferred<string>();
    const caller = new AbortController();
    const abortReason = new Error('caller disconnected');
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    let calls = 0;
    const acquire = () => {
      calls += 1;
      return acquisition.promise;
    };

    const remainingWaiter = coalescer.run('air:seoul', acquire);
    const abortedWaiter = coalescer.run('air:seoul', acquire, caller.signal);
    caller.abort(abortReason);
    acquisition.resolve('moderate');

    await expect(abortedWaiter).rejects.toBe(abortReason);
    await expect(remainingWaiter).resolves.toBe('moderate');
    expect(calls).toBe(1);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('allows acquisitions for different keys to progress independently', async () => {
    const coalescer = createLocalCoalescer();
    const seoul = deferred<string>();
    const busan = deferred<string>();
    const started: string[] = [];

    const seoulResult = coalescer.run('weather:seoul', () => {
      started.push('seoul');
      return seoul.promise;
    });
    const busanResult = coalescer.run('weather:busan', () => {
      started.push('busan');
      return busan.promise;
    });

    await Promise.resolve();
    expect(started).toEqual(['seoul', 'busan']);

    busan.resolve('rain');
    await expect(busanResult).resolves.toBe('rain');
    seoul.resolve('sunny');
    await expect(seoulResult).resolves.toBe('sunny');
  });

  it('starts a new acquisition after the previous value has settled', async () => {
    const coalescer = createLocalCoalescer();
    let value = 0;

    await expect(coalescer.run('macro', () => ++value)).resolves.toBe(1);
    await expect(coalescer.run('macro', () => ++value)).resolves.toBe(2);
  });

  it('does not start an acquisition for an already-aborted caller', async () => {
    const coalescer = createLocalCoalescer();
    const caller = new AbortController();
    const reason = new Error('already gone');
    let calls = 0;
    caller.abort(reason);

    const result = coalescer.run(
      'news',
      () => {
        calls += 1;
        return 'unused';
      },
      caller.signal,
    );

    await expect(result).rejects.toBe(reason);
    expect(calls).toBe(0);
  });

  it('removes the caller abort listener after the shared value settles', async () => {
    const coalescer = createLocalCoalescer();
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    await expect(coalescer.run('markets', () => 'closed', caller.signal)).resolves.toBe('closed');

    expect(removeListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
