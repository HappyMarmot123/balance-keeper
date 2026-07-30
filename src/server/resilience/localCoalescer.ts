export interface LocalCoalescer<Key = string> {
  run<Value>(key: Key, acquire: () => PromiseLike<Value> | Value, callerSignal?: AbortSignal): Promise<Value>;
  runAbortable<Value>(
    key: Key,
    acquire: (sharedSignal: AbortSignal) => PromiseLike<Value> | Value,
    callerSignal?: AbortSignal,
  ): Promise<Value>;
}

function waitForCaller<Value>(shared: Promise<Value>, callerSignal?: AbortSignal): Promise<Value> {
  if (!callerSignal) {
    return shared;
  }

  if (callerSignal.aborted) {
    return Promise.reject(callerSignal.reason);
  }

  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const finish = (settle: (value: Value | PromiseLike<Value>) => void, value: Value) => {
      if (settled) {
        return;
      }
      settled = true;
      callerSignal.removeEventListener('abort', onAbort);
      settle(value);
    };
    const fail = (reason: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      callerSignal.removeEventListener('abort', onAbort);
      reject(reason);
    };
    const onAbort = () => fail(callerSignal.reason);

    callerSignal.addEventListener('abort', onAbort, { once: true });
    void shared.then((value) => finish(resolve, value), fail);
  });
}

type AbortableAcquisition<Value> = {
  readonly controller: AbortController;
  readonly promise: Promise<Value>;
  settled: boolean;
  waiters: number;
};

function waitForAbortableCaller<Value>(
  acquisition: AbortableAcquisition<Value>,
  callerSignal?: AbortSignal,
): Promise<Value> {
  acquisition.waiters += 1;

  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const release = (abortReason?: unknown) => {
      acquisition.waiters -= 1;
      if (acquisition.waiters === 0 && !acquisition.settled && !acquisition.controller.signal.aborted) {
        acquisition.controller.abort(
          abortReason ?? new DOMException('The operation has no remaining callers', 'AbortError'),
        );
      }
    };
    const finish = (settle: (value: Value | PromiseLike<Value>) => void, value: Value) => {
      if (settled) {
        return;
      }
      settled = true;
      callerSignal?.removeEventListener('abort', onAbort);
      release();
      settle(value);
    };
    const fail = (reason: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      callerSignal?.removeEventListener('abort', onAbort);
      release(reason);
      reject(reason);
    };
    const onAbort = () => fail(callerSignal?.reason);

    callerSignal?.addEventListener('abort', onAbort, { once: true });
    void acquisition.promise.then((value) => finish(resolve, value), fail);
  });
}

export function createLocalCoalescer<Key = string>(): LocalCoalescer<Key> {
  const acquisitions = new Map<Key, Promise<unknown>>();
  const abortableAcquisitions = new Map<Key, AbortableAcquisition<unknown>>();

  return {
    run<Value>(key: Key, acquire: () => PromiseLike<Value> | Value, callerSignal?: AbortSignal): Promise<Value> {
      if (callerSignal?.aborted) {
        return Promise.reject<Value>(callerSignal.reason);
      }

      const current = acquisitions.get(key) as Promise<Value> | undefined;
      if (current) {
        return waitForCaller(current, callerSignal);
      }

      const started = Promise.resolve().then(acquire);
      acquisitions.set(key, started);
      const removeIfCurrent = () => {
        if (acquisitions.get(key) === started) {
          acquisitions.delete(key);
        }
      };
      void started.then(removeIfCurrent, removeIfCurrent);
      return waitForCaller(started, callerSignal);
    },
    runAbortable<Value>(
      key: Key,
      acquire: (sharedSignal: AbortSignal) => PromiseLike<Value> | Value,
      callerSignal?: AbortSignal,
    ): Promise<Value> {
      if (callerSignal?.aborted) {
        return Promise.reject<Value>(callerSignal.reason);
      }

      const current = abortableAcquisitions.get(key) as AbortableAcquisition<Value> | undefined;
      if (current !== undefined && !current.controller.signal.aborted) {
        return waitForAbortableCaller(current, callerSignal);
      }
      if (current !== undefined) {
        abortableAcquisitions.delete(key);
      }

      const controller = new AbortController();
      const started = Promise.resolve().then(() => acquire(controller.signal));
      const acquisition: AbortableAcquisition<Value> = {
        controller,
        promise: started,
        settled: false,
        waiters: 0,
      };
      abortableAcquisitions.set(key, acquisition);
      const removeIfCurrent = () => {
        acquisition.settled = true;
        if (abortableAcquisitions.get(key) === acquisition) {
          abortableAcquisitions.delete(key);
        }
      };
      void started.then(removeIfCurrent, removeIfCurrent);
      return waitForAbortableCaller(acquisition, callerSignal);
    },
  };
}
