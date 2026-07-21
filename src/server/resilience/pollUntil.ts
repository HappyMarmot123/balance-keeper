import type { Scheduler } from './withTimeout';
import { GatewayTimeoutError, withTimeout } from './withTimeout';

export interface PollUntilOptions {
  clock?: () => number;
  intervalMs: number;
  scheduler?: Scheduler;
  signal?: AbortSignal;
  sleep?: (delayMs: number, signal?: AbortSignal) => PromiseLike<void> | void;
  timeoutMs: number;
}

function rejectIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason;
  }
}

function waitForCaller<Value>(operation: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  if (!signal) {
    return operation;
  }

  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const resolveOnce = (value: Value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (reason: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(reason);
    };
    const onAbort = () => rejectOnce(signal.reason);

    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(resolveOnce, rejectOnce);
  });
}

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timerHandle);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason);
    };
    const timerHandle = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function pollWithinClockDeadline<Value>(
  check: () => PromiseLike<Value | undefined> | Value | undefined,
  options: PollUntilOptions,
  signal: AbortSignal,
): Promise<Value | undefined> {
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = clock();
  if (!Number.isFinite(startedAt)) {
    throw new RangeError('clock must return a finite number');
  }
  const deadline = startedAt + options.timeoutMs;
  if (!Number.isFinite(deadline)) {
    throw new RangeError('polling deadline must be finite');
  }

  while (true) {
    rejectIfAborted(signal);
    const value = await waitForCaller(Promise.resolve().then(check), signal);
    if (value !== undefined) {
      return value;
    }

    const now = clock();
    if (!Number.isFinite(now)) {
      throw new RangeError('clock must return a finite number');
    }
    if (now >= deadline) {
      return undefined;
    }

    const delayMs = Math.min(options.intervalMs, deadline - now);
    const sleeping = Promise.resolve().then(() => sleep(delayMs, signal));
    await waitForCaller(sleeping, signal);
  }
}

export async function pollUntil<Value>(
  check: () => PromiseLike<Value | undefined> | Value | undefined,
  options: PollUntilOptions,
): Promise<Value | undefined> {
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs <= 0) {
    throw new RangeError('intervalMs must be a positive safe integer');
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive safe integer');
  }

  let deadlineSignal: AbortSignal | undefined;

  try {
    return await withTimeout(
      (signal) => {
        deadlineSignal = signal;
        return pollWithinClockDeadline(check, options, signal);
      },
      {
        parentSignal: options.signal,
        scheduler: options.scheduler,
        timeoutMs: options.timeoutMs,
      },
    );
  } catch (error) {
    if (options.signal?.aborted && error === options.signal.reason) {
      throw error;
    }

    if (deadlineSignal?.aborted && deadlineSignal.reason === error && error instanceof GatewayTimeoutError) {
      return undefined;
    }

    throw error;
  }
}
