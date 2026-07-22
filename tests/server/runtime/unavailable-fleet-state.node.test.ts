import { describe, expect, it } from 'vitest';

const fleetStateMethods = [
  'readCache',
  'writeCache',
  'deleteCache',
  'tryAcquireLease',
  'releaseLease',
  'writeCacheIfLeaseOwner',
  'deleteCacheIfLeaseOwner',
  'consumeFixedWindow',
  'acquireBreaker',
  'completeBreaker',
] as const;

describe('unavailable fleet-state store', () => {
  it('fails every operation closed with SERVICE_UNAVAILABLE', async () => {
    const runtime = (await import('../../../src/server/runtime')) as Record<string, unknown>;

    expect(runtime.createUnavailableFleetStateStore).toEqual(expect.any(Function));

    const store = (runtime.createUnavailableFleetStateStore as () => Record<string, unknown>)();

    for (const methodName of fleetStateMethods) {
      expect(store[methodName], methodName).toEqual(expect.any(Function));
      await expect((store[methodName] as () => Promise<unknown>)()).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
      });
    }
  });
});
