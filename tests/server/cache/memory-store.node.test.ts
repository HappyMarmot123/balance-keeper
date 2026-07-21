// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { FleetStateStore } from '../../../src/server/cache';
import { MemoryFleetStateStore } from '../../../src/server/cache';

const asFleetStateStore = (store: MemoryFleetStateStore): FleetStateStore => store;

describe('MemoryFleetStateStore cache boundary', () => {
  it('exposes asynchronous cache read, write, and delete operations', () => {
    const store = asFleetStateStore(new MemoryFleetStateStore(() => 1_000));

    expect(store).toMatchObject({
      readCache: expect.any(Function),
      writeCache: expect.any(Function),
      deleteCache: expect.any(Function),
    });
  });
});

describe('MemoryFleetStateStore lease boundary', () => {
  it('exposes asynchronous owner-token lease operations', () => {
    const store = new MemoryFleetStateStore(() => 1_000);

    expect(store).toMatchObject({
      tryAcquireLease: expect.any(Function),
      releaseLease: expect.any(Function),
      writeCacheIfLeaseOwner: expect.any(Function),
      deleteCacheIfLeaseOwner: expect.any(Function),
    });
  });
});

describe('MemoryFleetStateStore fixed-window boundary', () => {
  it('exposes the asynchronous atomic counter operation', () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    expect(store).toMatchObject({ consumeFixedWindow: expect.any(Function) });
  });
});

describe('MemoryFleetStateStore breaker boundary', () => {
  it('exposes asynchronous acquire and completion operations', () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    expect(store).toMatchObject({
      acquireBreaker: expect.any(Function),
      completeBreaker: expect.any(Function),
    });
  });
});

describe('MemoryFleetStateStore cache TTL', () => {
  it('returns null for a missing cache key', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    await expect(store.readCache('cache:key')).resolves.toBeNull();
  });

  it('keeps a cache value before its TTL and removes it exactly at expiry', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    const record = { version: 1, kind: 'positive' };

    await store.writeCache('cache:key', record, 100);
    now = 1_099;
    await expect(store.readCache('cache:key')).resolves.toEqual(record);

    now = 1_100;
    await expect(store.readCache('cache:key')).resolves.toBeNull();
  });

  it('atomically overwrites the previous value and resets its TTL', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);

    await store.writeCache('cache:key', { revision: 1 }, 100);
    now = 1_050;
    await store.writeCache('cache:key', { revision: 2 }, 200);
    now = 1_249;
    await expect(store.readCache('cache:key')).resolves.toEqual({ revision: 2 });
    now = 1_250;
    await expect(store.readCache('cache:key')).resolves.toBeNull();
  });

  it('stores and returns JSON snapshots instead of sharing caller references', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    const input = { nested: { value: 1 } };

    await store.writeCache('cache:key', input, 100);
    input.nested.value = 2;
    const firstRead = (await store.readCache('cache:key')) as { nested: { value: number } };
    expect(firstRead).toEqual({ nested: { value: 1 } });

    firstRead.nested.value = 3;
    await expect(store.readCache('cache:key')).resolves.toEqual({ nested: { value: 1 } });
  });

  it.each([1n, new Date(0), { value: undefined }])('rejects non-JSON cache value %#', async (value) => {
    const store = new MemoryFleetStateStore(() => 1_000);

    await expect(store.writeCache('cache:key', value, 100)).rejects.toThrow(TypeError);
  });

  it('reports whether a live cache value was deleted', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);

    await store.writeCache('cache:key', { value: 1 }, 10);
    await expect(store.deleteCache('cache:key')).resolves.toBe(true);
    await expect(store.deleteCache('cache:key')).resolves.toBe(false);

    await store.writeCache('cache:key', { value: 2 }, 10);
    now = 1_010;
    await expect(store.deleteCache('cache:key')).resolves.toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])('rejects invalid TTL %s', async (ttlMs) => {
    const store = new MemoryFleetStateStore(() => 1_000);
    await expect(store.writeCache('cache:key', {}, ttlMs)).rejects.toThrow(RangeError);
  });

  it('rejects a TTL that would overflow safe epoch milliseconds', async () => {
    const store = new MemoryFleetStateStore(() => Number.MAX_SAFE_INTEGER - 5);
    await expect(store.writeCache('cache:key', {}, 10)).rejects.toThrow(RangeError);
  });
});

describe('MemoryFleetStateStore owner-safe leases', () => {
  it('allows one owner per key while allowing a different key', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);

    await expect(store.tryAcquireLease('lease:a', 'owner-a', 100)).resolves.toBe(true);
    await expect(store.tryAcquireLease('lease:a', 'owner-b', 100)).resolves.toBe(false);
    await expect(store.tryAcquireLease('lease:b', 'owner-b', 100)).resolves.toBe(true);
  });

  it('allows a new owner exactly when the old lease expires', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);

    await store.tryAcquireLease('lease:a', 'owner-a', 100);
    now = 1_099;
    await expect(store.tryAcquireLease('lease:a', 'owner-b', 100)).resolves.toBe(false);
    now = 1_100;
    await expect(store.tryAcquireLease('lease:a', 'owner-b', 100)).resolves.toBe(true);
  });

  it('releases only when the live owner token matches', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);

    await store.tryAcquireLease('lease:a', 'owner-a', 100);
    await expect(store.releaseLease('lease:a', 'owner-b')).resolves.toBe(false);
    await expect(store.tryAcquireLease('lease:a', 'owner-b', 100)).resolves.toBe(false);
    await expect(store.releaseLease('lease:a', 'owner-a')).resolves.toBe(true);
    await expect(store.tryAcquireLease('lease:a', 'owner-b', 100)).resolves.toBe(true);
  });

  it('does not let a late old-owner release delete a reacquired lease', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);

    await store.tryAcquireLease('lease:a', 'old-owner', 100);
    now = 1_100;
    await store.tryAcquireLease('lease:a', 'new-owner', 100);

    await expect(store.releaseLease('lease:a', 'old-owner')).resolves.toBe(false);
    await expect(store.tryAcquireLease('lease:a', 'third-owner', 100)).resolves.toBe(false);
    await expect(store.releaseLease('lease:a', 'new-owner')).resolves.toBe(true);
  });

  it('atomically admits one of two concurrent store users', async () => {
    const sharedStore = new MemoryFleetStateStore(() => 1_000);
    const firstUser = sharedStore;
    const secondUser = sharedStore;

    const results = await Promise.all([
      firstUser.tryAcquireLease('lease:a', 'owner-a', 100),
      secondUser.tryAcquireLease('lease:a', 'owner-b', 100),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('rejects an empty owner token and invalid lease TTL', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);

    await expect(store.tryAcquireLease('lease:a', '', 100)).rejects.toThrow(TypeError);
    await expect(store.tryAcquireLease('lease:a', 'owner-a', 0)).rejects.toThrow(RangeError);
  });
});

describe('MemoryFleetStateStore lease-fenced cache writes', () => {
  it('commits a JSON snapshot instead of retaining the owner input reference', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    const input = { nested: { value: 1 } };
    await store.tryAcquireLease('lease:a', 'owner-a', 100);

    await store.writeCacheIfLeaseOwner({
      leaseKey: 'lease:a',
      leaseToken: 'owner-a',
      cacheKey: 'cache:a',
      value: input,
      ttlMs: 100,
    });
    input.nested.value = 2;

    await expect(store.readCache('cache:a')).resolves.toEqual({ nested: { value: 1 } });
  });

  it('prevents an expired old owner from overwriting the new owner value', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    const leaseKey = 'lease:weather';
    const cacheKey = 'cache:weather';

    await store.tryAcquireLease(leaseKey, 'owner-a', 100);
    now = 1_100;
    await store.tryAcquireLease(leaseKey, 'owner-b', 100);

    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey,
        leaseToken: 'owner-b',
        cacheKey,
        value: { revision: 'new' },
        ttlMs: 500,
      }),
    ).resolves.toBe(true);
    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey,
        leaseToken: 'owner-a',
        cacheKey,
        value: { revision: 'late-old' },
        ttlMs: 500,
      }),
    ).resolves.toBe(false);

    await expect(store.readCache(cacheKey)).resolves.toEqual({ revision: 'new' });
  });

  it('writes only for the matching live lease owner and keeps the lease held', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    await store.tryAcquireLease('lease:a', 'owner-a', 100);

    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: 'owner-a',
        cacheKey: 'cache:a',
        value: { value: 1 },
        ttlMs: 100,
      }),
    ).resolves.toBe(true);
    await expect(store.tryAcquireLease('lease:a', 'owner-b', 100)).resolves.toBe(false);
  });

  it('rejects a write exactly when its owner lease expires', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    await store.tryAcquireLease('lease:a', 'owner-a', 100);
    await store.writeCache('cache:a', { revision: 'existing' }, 500);
    now = 1_100;

    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: 'owner-a',
        cacheKey: 'cache:a',
        value: { revision: 'expired-owner' },
        ttlMs: 100,
      }),
    ).resolves.toBe(false);
    await expect(store.readCache('cache:a')).resolves.toEqual({ revision: 'existing' });
  });

  it('validates the lease token and cache TTL before committing', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);

    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: '',
        cacheKey: 'cache:a',
        value: {},
        ttlMs: 100,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: 'owner-a',
        cacheKey: 'cache:a',
        value: {},
        ttlMs: 0,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('MemoryFleetStateStore lease-fenced cache deletes', () => {
  it('deletes only for the matching live owner and succeeds when cache is already absent', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    await store.tryAcquireLease('lease:a', 'owner-a', 100);
    await store.writeCache('cache:a', { stale: true }, 500);

    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-a', cacheKey: 'cache:a' }),
    ).resolves.toBe(true);
    await expect(store.readCache('cache:a')).resolves.toBeNull();
    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-a', cacheKey: 'cache:a' }),
    ).resolves.toBe(true);
  });

  it('prevents an expired old owner from deleting a new owner value', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    await store.tryAcquireLease('lease:a', 'owner-a', 100);
    now = 1_100;
    await store.tryAcquireLease('lease:a', 'owner-b', 100);
    await store.writeCacheIfLeaseOwner({
      leaseKey: 'lease:a',
      leaseToken: 'owner-b',
      cacheKey: 'cache:a',
      value: { revision: 'new' },
      ttlMs: 500,
    });

    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-a', cacheKey: 'cache:a' }),
    ).resolves.toBe(false);
    await expect(store.readCache('cache:a')).resolves.toEqual({ revision: 'new' });
    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-b', cacheKey: 'cache:a' }),
    ).resolves.toBe(true);
    await expect(store.readCache('cache:a')).resolves.toBeNull();
  });

  it('rejects an invalid lease token before checking ownership', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: '', cacheKey: 'cache:a' }),
    ).rejects.toThrow(TypeError);
  });
});

describe('MemoryFleetStateStore fixed-window counters', () => {
  const policy = { limit: 2, windowMs: 100 };

  it('admits through the exact limit without extending the anchored window', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);

    await expect(store.consumeFixedWindow('rate:a', policy)).resolves.toEqual({
      allowed: true,
      count: 1,
      remaining: 1,
      resetAt: 1_100,
      retryAfterMs: 0,
    });
    await expect(store.consumeFixedWindow('rate:a', policy)).resolves.toEqual({
      allowed: true,
      count: 2,
      remaining: 0,
      resetAt: 1_100,
      retryAfterMs: 0,
    });
    await expect(store.consumeFixedWindow('rate:a', policy)).resolves.toEqual({
      allowed: false,
      count: 3,
      remaining: 0,
      resetAt: 1_100,
      retryAfterMs: 100,
    });

    now = 1_099;
    await expect(store.consumeFixedWindow('rate:a', policy)).resolves.toMatchObject({
      allowed: false,
      count: 4,
      resetAt: 1_100,
      retryAfterMs: 1,
    });
  });

  it('starts a new window exactly at the reset boundary', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);

    await store.consumeFixedWindow('rate:a', { limit: 1, windowMs: 100 });
    now = 1_100;

    await expect(store.consumeFixedWindow('rate:a', { limit: 1, windowMs: 100 })).resolves.toEqual({
      allowed: true,
      count: 1,
      remaining: 0,
      resetAt: 1_200,
      retryAfterMs: 0,
    });
  });

  it('keeps different counter keys independent', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);

    await store.consumeFixedWindow('rate:a', { limit: 1, windowMs: 100 });
    await expect(store.consumeFixedWindow('rate:a', { limit: 1, windowMs: 100 })).resolves.toMatchObject({
      allowed: false,
    });
    await expect(store.consumeFixedWindow('rate:b', { limit: 1, windowMs: 100 })).resolves.toMatchObject({
      allowed: true,
      count: 1,
    });
  });

  it('atomically combines consumption from two store users', async () => {
    const sharedStore = new MemoryFleetStateStore(() => 1_000);
    const firstUser = sharedStore;
    const secondUser = sharedStore;

    const results = await Promise.all([
      firstUser.consumeFixedWindow('rate:a', { limit: 1, windowMs: 100 }),
      secondUser.consumeFixedWindow('rate:a', { limit: 1, windowMs: 100 }),
    ]);

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.map((result) => result.count).sort()).toEqual([1, 2]);
  });

  it.each([
    [{ limit: 0, windowMs: 100 }, 'limit'],
    [{ limit: 1.5, windowMs: 100 }, 'limit'],
    [{ limit: 1, windowMs: 0 }, 'window'],
    [{ limit: 1, windowMs: Number.NaN }, 'window'],
  ])('rejects invalid %s policy', async (invalidPolicy) => {
    const store = new MemoryFleetStateStore(() => 1_000);
    await expect(store.consumeFixedWindow('rate:a', invalidPolicy)).rejects.toThrow(RangeError);
  });
});

describe('MemoryFleetStateStore circuit breaker', () => {
  const policy = {
    failureThreshold: 2,
    failureWindowMs: 200,
    cooldownMs: 100,
    halfOpenLeaseMs: 50,
    closedCompletionBoundMs: 100,
    stateRetentionMs: 500,
  };

  const requireAllowed = async (store: MemoryFleetStateStore, key: string, candidateToken: string) => {
    const permit = await store.acquireBreaker(key, candidateToken, policy);
    expect(permit.allowed).toBe(true);

    if (!permit.allowed) {
      throw new Error('Expected an allowed breaker permit');
    }

    return permit;
  };

  const tripBreaker = async (store: MemoryFleetStateStore, key: string) => {
    const first = await requireAllowed(store, key, 'closed-a');
    await store.completeBreaker(key, first, 'FAILURE', policy);
    const second = await requireAllowed(store, key, 'closed-b');
    await store.completeBreaker(key, second, 'FAILURE', policy);
  };

  it('starts CLOSED and a successful call keeps it CLOSED', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    const first = await requireAllowed(store, 'breaker:a', 'closed-a');

    expect(first.state).toBe('CLOSED');
    await expect(store.completeBreaker('breaker:a', first, 'SUCCESS', policy)).resolves.toBe(true);
    await expect(store.acquireBreaker('breaker:a', 'closed-b', policy)).resolves.toMatchObject({
      allowed: true,
      state: 'CLOSED',
    });
  });

  it('opens exactly at the failure threshold and reports the cooldown remainder', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);

    await tripBreaker(store, 'breaker:a');
    await expect(store.acquireBreaker('breaker:a', 'probe-a', policy)).resolves.toEqual({
      allowed: false,
      state: 'OPEN',
      retryAfterMs: 100,
    });

    now = 1_099;
    await expect(store.acquireBreaker('breaker:a', 'probe-a', policy)).resolves.toEqual({
      allowed: false,
      state: 'OPEN',
      retryAfterMs: 1,
    });
  });

  it('admits one HALF_OPEN probe exactly at cooldown and closes on success', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    await tripBreaker(store, 'breaker:a');
    now = 1_100;

    const [first, second] = await Promise.all([
      store.acquireBreaker('breaker:a', 'probe-a', policy),
      store.acquireBreaker('breaker:a', 'probe-b', policy),
    ]);
    const probe = [first, second].find((permit) => permit.allowed);

    expect([first, second].filter((permit) => permit.allowed)).toHaveLength(1);
    expect([first, second].find((permit) => !permit.allowed)).toEqual({
      allowed: false,
      state: 'HALF_OPEN',
      retryAfterMs: 50,
    });
    if (!probe?.allowed) {
      throw new Error('Expected one half-open probe');
    }
    expect(probe.state).toBe('HALF_OPEN');
    await expect(store.completeBreaker('breaker:a', probe, 'SUCCESS', policy)).resolves.toBe(true);
    await expect(store.acquireBreaker('breaker:a', 'closed-next', policy)).resolves.toMatchObject({
      allowed: true,
      state: 'CLOSED',
    });
  });

  it('reopens for a full cooldown when the HALF_OPEN probe fails', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    await tripBreaker(store, 'breaker:a');
    now = 1_100;
    const probe = await requireAllowed(store, 'breaker:a', 'probe-a');

    await store.completeBreaker('breaker:a', probe, 'FAILURE', policy);
    await expect(store.acquireBreaker('breaker:a', 'probe-b', policy)).resolves.toEqual({
      allowed: false,
      state: 'OPEN',
      retryAfterMs: 100,
    });
  });

  it('treats a neutral HALF_OPEN completion as no failure and permits a replacement immediately', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    await tripBreaker(store, 'breaker:a');
    now = 1_100;
    const abandoned = await requireAllowed(store, 'breaker:a', 'probe-a');

    await store.completeBreaker('breaker:a', abandoned, 'NEUTRAL', policy);
    await expect(store.acquireBreaker('breaker:a', 'probe-b', policy)).resolves.toEqual({
      allowed: true,
      state: 'HALF_OPEN',
      token: 'probe-b',
    });
  });

  it('replaces an expired HALF_OPEN owner and ignores its late completion', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    await tripBreaker(store, 'breaker:a');
    now = 1_100;
    const oldProbe = await requireAllowed(store, 'breaker:a', 'probe-old');

    now = 1_149;
    await expect(store.acquireBreaker('breaker:a', 'probe-new', policy)).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 1,
    });
    now = 1_150;
    const newProbe = await requireAllowed(store, 'breaker:a', 'probe-new');
    expect(newProbe).toEqual({ allowed: true, state: 'HALF_OPEN', token: 'probe-new' });

    await expect(store.completeBreaker('breaker:a', oldProbe, 'SUCCESS', policy)).resolves.toBe(false);
    await expect(store.acquireBreaker('breaker:a', 'probe-third', policy)).resolves.toMatchObject({
      allowed: false,
      state: 'HALF_OPEN',
    });
    await expect(store.completeBreaker('breaker:a', newProbe, 'SUCCESS', policy)).resolves.toBe(true);
  });

  it('resets accumulated failures exactly at the failure-window boundary', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    const first = await requireAllowed(store, 'breaker:a', 'closed-a');
    await store.completeBreaker('breaker:a', first, 'FAILURE', policy);

    now = 1_200;
    const afterWindow = await requireAllowed(store, 'breaker:a', 'closed-new-window');
    await store.completeBreaker('breaker:a', afterWindow, 'FAILURE', policy);

    await expect(store.acquireBreaker('breaker:a', 'still-closed', policy)).resolves.toMatchObject({
      allowed: true,
      state: 'CLOSED',
    });
  });

  it('anchors the failure window to the first recorded failure rather than permit acquisition', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    const slowFailure = await requireAllowed(store, 'breaker:a', 'slow-call');

    now = 1_200;
    await expect(store.completeBreaker('breaker:a', slowFailure, 'FAILURE', policy)).resolves.toBe(true);
    const secondFailure = await requireAllowed(store, 'breaker:a', 'second-call');
    await store.completeBreaker('breaker:a', secondFailure, 'FAILURE', policy);

    await expect(store.acquireBreaker('breaker:a', 'probe-a', policy)).resolves.toEqual({
      allowed: false,
      state: 'OPEN',
      retryAfterMs: 100,
    });
  });

  it.each(['completion-first', 'acquire-first'] as const)(
    'counts an in-flight failure in the new window with %s boundary ordering',
    async (ordering) => {
      let now = 1_000;
      const store = new MemoryFleetStateStore(() => now);
      const first = await requireAllowed(store, 'breaker:a', 'closed-cycle');
      await store.completeBreaker('breaker:a', first, 'FAILURE', policy);
      now = 1_199;
      const inFlight = await requireAllowed(store, 'breaker:a', 'in-flight');
      now = 1_200;

      if (ordering === 'acquire-first') {
        const boundaryPermit = await requireAllowed(store, 'breaker:a', 'boundary-acquire');
        expect(boundaryPermit.token).toBe(inFlight.token);
      }

      await expect(store.completeBreaker('breaker:a', inFlight, 'FAILURE', policy)).resolves.toBe(true);
      const thresholdFailure = await requireAllowed(store, 'breaker:a', 'threshold-failure');
      await store.completeBreaker('breaker:a', thresholdFailure, 'FAILURE', policy);
      await expect(store.acquireBreaker('breaker:a', 'probe', policy)).resolves.toEqual({
        allowed: false,
        state: 'OPEN',
        retryAfterMs: 100,
      });
    },
  );

  it('keeps a CLOSED completion through its declared bound and forgets state exactly at retention', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    const slowPermit = await requireAllowed(store, 'breaker:slow', 'slow-cycle');
    now = 1_099;
    await expect(store.completeBreaker('breaker:slow', slowPermit, 'FAILURE', policy)).resolves.toBe(true);

    const retained = await requireAllowed(store, 'breaker:retention', 'retained-cycle');
    now = 1_499;
    await expect(store.acquireBreaker('breaker:retention', 'before-expiry', policy)).resolves.toMatchObject({
      allowed: true,
      token: retained.token,
    });
    now = 1_999;
    await expect(store.acquireBreaker('breaker:retention', 'after-refresh-boundary', policy)).resolves.toMatchObject({
      allowed: true,
      token: 'after-refresh-boundary',
    });
  });

  it('refreshes retention for a denied OPEN acquire', async () => {
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    await tripBreaker(store, 'breaker:a');
    now = 1_050;
    await expect(store.acquireBreaker('breaker:a', 'denied', policy)).resolves.toMatchObject({
      allowed: false,
      state: 'OPEN',
    });

    now = 1_501;
    await expect(store.acquireBreaker('breaker:a', 'probe-after-original-retention', policy)).resolves.toMatchObject({
      allowed: true,
      state: 'HALF_OPEN',
    });
  });

  it('resets accumulated failures on a CLOSED success and leaves NEUTRAL unchanged', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    const failed = await requireAllowed(store, 'breaker:a', 'closed-a');
    await store.completeBreaker('breaker:a', failed, 'FAILURE', policy);
    const neutral = await requireAllowed(store, 'breaker:a', 'closed-b');
    await store.completeBreaker('breaker:a', neutral, 'NEUTRAL', policy);
    const succeeded = await requireAllowed(store, 'breaker:a', 'closed-c');
    await store.completeBreaker('breaker:a', succeeded, 'SUCCESS', policy);
    const nextFailure = await requireAllowed(store, 'breaker:a', 'closed-d');
    await store.completeBreaker('breaker:a', nextFailure, 'FAILURE', policy);

    await expect(store.acquireBreaker('breaker:a', 'still-closed', policy)).resolves.toMatchObject({
      allowed: true,
      state: 'CLOSED',
    });
  });

  it.each([
    { ...policy, failureThreshold: 0 },
    { ...policy, failureThreshold: 1.5 },
    { ...policy, failureWindowMs: 0 },
    { ...policy, cooldownMs: 0 },
    { ...policy, halfOpenLeaseMs: Number.NaN },
    { ...policy, closedCompletionBoundMs: 0 },
    { ...policy, stateRetentionMs: 0 },
    { ...policy, stateRetentionMs: policy.failureWindowMs },
  ])('rejects an invalid breaker policy', async (invalidPolicy) => {
    const store = new MemoryFleetStateStore(() => 1_000);
    await expect(store.acquireBreaker('breaker:a', 'candidate', invalidPolicy)).rejects.toThrow(RangeError);
  });

  it('rejects empty candidate tokens and unknown outcomes', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    await expect(store.acquireBreaker('breaker:a', '', policy)).rejects.toThrow(TypeError);
    const permit = await requireAllowed(store, 'breaker:a', 'closed-a');
    await expect(store.completeBreaker('breaker:a', permit, 'UNKNOWN' as 'NEUTRAL', policy)).rejects.toThrow(TypeError);
  });
});
