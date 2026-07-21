export interface LocalCoalescer<Key = string> {
  run<Value>(key: Key, acquire: () => PromiseLike<Value> | Value, callerSignal?: AbortSignal): Promise<Value>;
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

export function createLocalCoalescer<Key = string>(): LocalCoalescer<Key> {
  const acquisitions = new Map<Key, Promise<unknown>>();

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
  };
}
