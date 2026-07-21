// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { GatewayTimeoutError, withTimeout } from '../../../src/server/resilience';

describe('withTimeout', () => {
  it('aborts the operation and rejects with a gateway timeout at the deadline', async () => {
    let deadline: (() => void) | undefined;
    let scheduledDelay: number | undefined;
    let clearedHandle: unknown;
    const scheduler = {
      clearTimeout(handle: unknown) {
        clearedHandle = handle;
      },
      setTimeout(callback: () => void, delayMs: number) {
        deadline = callback;
        scheduledDelay = delayMs;
        return 'timer-1';
      },
    };
    let operationSignal: AbortSignal | undefined;

    const pending = withTimeout(
      (signal) => {
        operationSignal = signal;
        return new Promise<string>(() => undefined);
      },
      { scheduler, timeoutMs: 250 },
    );

    expect(scheduledDelay).toBe(250);
    expect(operationSignal?.aborted).toBe(false);
    deadline?.();

    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toMatchObject({ name: 'GatewayTimeoutError', timeoutMs: 250 });
    expect(operationSignal?.aborted).toBe(true);
    expect(operationSignal?.reason).toBe(error);
    expect(clearedHandle).toBe('timer-1');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects the invalid timeout %s before starting the operation',
    (timeoutMs) => {
      let operationCalls = 0;
      const scheduler = {
        clearTimeout() {},
        setTimeout() {
          return 'unused';
        },
      };

      expect(() =>
        withTimeout(
          () => {
            operationCalls += 1;
            return 'unused';
          },
          { scheduler, timeoutMs },
        ),
      ).toThrow(RangeError);
      expect(operationCalls).toBe(0);
    },
  );

  it('cleans up the parent listener when the injected scheduler fails', async () => {
    const caller = new AbortController();
    const failure = new Error('scheduler unavailable');
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    let operationCalls = 0;

    const result = withTimeout(
      () => {
        operationCalls += 1;
        return 'unused';
      },
      {
        parentSignal: caller.signal,
        scheduler: {
          clearTimeout() {},
          setTimeout() {
            throw failure;
          },
        },
        timeoutMs: 100,
      },
    );

    await expect(result).rejects.toBe(failure);
    expect(operationCalls).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('preserves a parent abort reason and aborts only with that reason', async () => {
    const caller = new AbortController();
    const reason = new Error('request closed');
    let deadline: (() => void) | undefined;
    let clearedHandle: unknown;
    let operationSignal: AbortSignal | undefined;

    const result = withTimeout(
      (signal) => {
        operationSignal = signal;
        return new Promise<string>(() => undefined);
      },
      {
        parentSignal: caller.signal,
        scheduler: {
          clearTimeout(handle) {
            clearedHandle = handle;
          },
          setTimeout(callback) {
            deadline = callback;
            return 'parent-timer';
          },
        },
        timeoutMs: 100,
      },
    );

    caller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(operationSignal?.aborted).toBe(true);
    expect(operationSignal?.reason).toBe(reason);
    expect(clearedHandle).toBe('parent-timer');

    deadline?.();
    await expect(result).rejects.toBe(reason);
  });

  it('does not schedule or start work for an already-aborted parent', async () => {
    const caller = new AbortController();
    const reason = new Error('request was already closed');
    caller.abort(reason);
    let scheduleCalls = 0;
    let operationCalls = 0;

    const result = withTimeout(
      () => {
        operationCalls += 1;
        return 'unused';
      },
      {
        parentSignal: caller.signal,
        scheduler: {
          clearTimeout() {},
          setTimeout() {
            scheduleCalls += 1;
            return 'unused';
          },
        },
        timeoutMs: 100,
      },
    );

    await expect(result).rejects.toBe(reason);
    expect(scheduleCalls).toBe(0);
    expect(operationCalls).toBe(0);
  });

  it('clears the timer and parent listener when the operation settles', async () => {
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    const clearTimeout = vi.fn();

    await expect(
      withTimeout(() => 'ready', {
        parentSignal: caller.signal,
        scheduler: {
          clearTimeout,
          setTimeout() {
            return 'success-timer';
          },
        },
        timeoutMs: 100,
      }),
    ).resolves.toBe('ready');

    expect(clearTimeout).toHaveBeenCalledWith('success-timer');
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('ignores a late operation resolution after timing out', async () => {
    let deadline: (() => void) | undefined;
    let resolveOperation!: (value: string) => void;
    const operation = new Promise<string>((resolve) => {
      resolveOperation = resolve;
    });

    const result = withTimeout(() => operation, {
      scheduler: {
        clearTimeout() {},
        setTimeout(callback) {
          deadline = callback;
          return 'late-timer';
        },
      },
      timeoutMs: 100,
    });

    deadline?.();
    const timeout = await result.catch((reason: unknown) => reason);
    resolveOperation('too late');
    await Promise.resolve();

    expect(timeout).toMatchObject({ name: 'GatewayTimeoutError' });
    await expect(result).rejects.toBe(timeout);
  });

  it('observes and ignores a late operation rejection after timing out', async () => {
    let deadline: (() => void) | undefined;
    let rejectOperation!: (reason: unknown) => void;
    const operation = new Promise<string>((_, reject) => {
      rejectOperation = reject;
    });

    const result = withTimeout(() => operation, {
      scheduler: {
        clearTimeout() {},
        setTimeout(callback) {
          deadline = callback;
          return 'late-rejection-timer';
        },
      },
      timeoutMs: 100,
    });

    deadline?.();
    const timeout = await result.catch((reason: unknown) => reason);
    rejectOperation(new Error('late provider rejection'));
    await Promise.resolve();

    expect(timeout).toMatchObject({ name: 'GatewayTimeoutError' });
    await expect(result).rejects.toBe(timeout);
  });

  it('uses the global scheduler when no scheduler is injected', async () => {
    vi.useFakeTimers();
    try {
      const result = withTimeout(() => new Promise<string>(() => undefined), { timeoutMs: 25 });
      const rejection = expect(result).rejects.toBeInstanceOf(GatewayTimeoutError);

      await vi.advanceTimersByTimeAsync(25);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
