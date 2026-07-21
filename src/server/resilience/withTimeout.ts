export interface Scheduler {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

export interface WithTimeoutOptions {
  parentSignal?: AbortSignal;
  scheduler?: Scheduler;
  timeoutMs: number;
}

export class GatewayTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Gateway operation exceeded its ${timeoutMs}ms deadline`);
    this.name = 'GatewayTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

const defaultScheduler: Scheduler = {
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
};

export function withTimeout<Value>(
  operation: (signal: AbortSignal) => PromiseLike<Value> | Value,
  options: WithTimeoutOptions,
): Promise<Value> {
  const { parentSignal, timeoutMs } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive safe integer');
  }

  if (parentSignal?.aborted) {
    return Promise.reject<Value>(parentSignal.reason);
  }

  const scheduler = options.scheduler ?? defaultScheduler;
  const operationController = new AbortController();

  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    let timerHandle: unknown;
    let timerScheduled = false;

    const cleanup = () => {
      if (timerScheduled) {
        scheduler.clearTimeout(timerHandle);
      }
      parentSignal?.removeEventListener('abort', onParentAbort);
    };
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
    const onParentAbort = () => {
      const reason = parentSignal?.reason;
      operationController.abort(reason);
      rejectOnce(reason);
    };
    const onDeadline = () => {
      const error = new GatewayTimeoutError(timeoutMs);
      operationController.abort(error);
      rejectOnce(error);
    };

    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    try {
      timerHandle = scheduler.setTimeout(onDeadline, timeoutMs);
      timerScheduled = true;
    } catch (error) {
      rejectOnce(error);
      return;
    }

    try {
      const result = operation(operationController.signal);
      void Promise.resolve(result).then(resolveOnce, rejectOnce);
    } catch (error) {
      rejectOnce(error);
    }
  });
}
