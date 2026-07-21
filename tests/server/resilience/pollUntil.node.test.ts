// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as resilience from '../../../src/server/resilience';
import { pollUntil } from '../../../src/server/resilience';

describe('pollUntil', () => {
  it('is available through the resilience public API', () => {
    const candidate = (resilience as Record<string, unknown>).pollUntil;

    expect(candidate).toBeTypeOf('function');
  });

  it('performs a final check at the exact deadline without sleeping past it', async () => {
    let now = 0;
    const checks: number[] = [];
    const sleeps: number[] = [];

    const result = await pollUntil(
      () => {
        checks.push(now);
        return now === 100 ? 'available' : undefined;
      },
      {
        clock: () => now,
        intervalMs: 40,
        sleep: (delayMs) => {
          sleeps.push(delayMs);
          now += delayMs;
        },
        timeoutMs: 100,
      },
    );

    expect(result).toBe('available');
    expect(checks).toEqual([0, 40, 80, 100]);
    expect(sleeps).toEqual([40, 40, 20]);
  });

  it.each([
    { intervalMs: 0, timeoutMs: 10 },
    { intervalMs: 1, timeoutMs: 0 },
    { intervalMs: 1, timeoutMs: -1 },
    { intervalMs: 1.5, timeoutMs: 10 },
  ])('rejects invalid polling bounds %#', async ({ intervalMs, timeoutMs }) => {
    let now = 0;

    await expect(
      pollUntil(() => undefined, {
        clock: () => now,
        intervalMs,
        sleep: (delayMs) => {
          now += Math.max(1, delayMs);
        },
        timeoutMs,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('rejects a non-finite injected clock instead of polling without a bound', async () => {
    await expect(
      pollUntil(() => undefined, {
        clock: () => Number.NaN,
        intervalMs: 10,
        sleep: () => {
          throw new Error('sleep should not start');
        },
        timeoutMs: 100,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('stops a pending check with the caller original abort reason and removes its listener', async () => {
    const caller = new AbortController();
    const reason = new Error('lease waiter disconnected');
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    const result = pollUntil(() => new Promise<string | undefined>(() => undefined), {
      clock: () => 0,
      intervalMs: 10,
      signal: caller.signal,
      sleep: () => undefined,
      timeoutMs: 100,
    });

    caller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('returns at the actual deadline even when a cache check never settles', async () => {
    let deadline: (() => void) | undefined;
    const clearTimeout = vi.fn();

    const result = pollUntil(() => new Promise<string | undefined>(() => undefined), {
      clock: () => 0,
      intervalMs: 10,
      scheduler: {
        clearTimeout,
        setTimeout(callback) {
          deadline = callback;
          return 'poll-deadline';
        },
      },
      sleep: () => undefined,
      timeoutMs: 100,
    });

    expect(deadline).toBeTypeOf('function');
    deadline?.();

    await expect(result).resolves.toBeUndefined();
    expect(clearTimeout).toHaveBeenCalledWith('poll-deadline');
  });
});
