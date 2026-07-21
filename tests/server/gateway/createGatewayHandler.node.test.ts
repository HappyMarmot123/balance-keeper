// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createCacheKey,
  createStateKey,
  type FixedWindowConsumption,
  MemoryFleetStateStore,
} from '../../../src/server/cache';
import {
  createAdmissionSubject,
  createGatewayHandler,
  createRouteProfile,
  createRouteRegistry,
  type GatewayDependencies,
  type GatewayRoute,
  rethrowAsUpstreamUnavailable,
} from '../../../src/server/gateway';
import type { GatewayLogEvent } from '../../../src/server/observability';
import { createLocalCoalescer } from '../../../src/server/resilience';
import { AppError } from '../../../src/shared/contracts';

const profile = createRouteProfile({
  freshForMs: 100,
  staleIfErrorForMs: 500,
  negativeForMs: 50,
  upstreamTimeoutMs: 80,
  lockWaitMs: 40,
  lockPollMs: 5,
  lockSafetyMs: 20,
  admissionRate: { limit: 20, windowMs: 1_000, scope: 'route.fixture' },
  upstreamBudget: { limit: 10, windowMs: 1_000, scope: 'provider.fixture' },
  breaker: {
    scope: 'provider.fixture',
    failureThreshold: 2,
    failureWindowMs: 500,
    cooldownMs: 100,
    probeTimeoutMs: 50,
  },
  cdnMaxAgeSeconds: 60,
});

const dataSchema = z.object({ value: z.number().int() }).strict();

const createDependencies = (
  clock: () => number,
  store = new MemoryFleetStateStore(clock),
  instance = '',
): GatewayDependencies => {
  let requestSequence = 0;
  let tokenSequence = 0;
  const prefix = instance.length === 0 ? '' : `${instance}-`;

  return {
    clock,
    createCoordinationToken: () => `${prefix}coordination-${++tokenSequence}`,
    createRequestId: () => `${prefix}request-${++requestSequence}`,
    fleetStateStore: store,
    localCoalescer: createLocalCoalescer(),
  };
};

const deferred = <Value>() => {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const createFixtureRoute = (load: GatewayRoute['load'], routeProfile = profile): GatewayRoute => ({
  id: 'fixture',
  path: '/api/fixture',
  dataSchema,
  profile: routeProfile,
  parseRequest: () => ({
    input: { region: 'seoul' },
    publicCacheIdentity: { region: 'seoul' },
    admissionSubject: createAdmissionSubject('opaque-client-a'),
  }),
  load,
});

describe('createGatewayHandler', () => {
  it('returns the strict NOT_FOUND envelope for an unregistered path', async () => {
    const clock = () => 1_000;
    const handler = createGatewayHandler(createRouteRegistry([]));

    const response = await handler(new Request('https://balance.test/api/missing'), createDependencies(clock));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('request-1');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', requestId: 'request-1' },
    });
  });

  it('stores a validated MISS and serves the same representation as a fresh HIT', async () => {
    let now = 1_000;
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 7 }, source: 'fixture-provider', fetchedAt: 900 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);
    const request = () => new Request('https://balance.test/api/fixture?region=seoul');

    const miss = await handler(request(), dependencies);
    expect(miss.status).toBe(200);
    expect(miss.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(await miss.json()).toEqual({
      data: { value: 7 },
      meta: {
        cache: 'MISS',
        fetchedAt: 900,
        requestId: 'request-1',
        source: 'fixture-provider',
      },
    });

    now = 1_099;
    const hit = await handler(request(), dependencies);
    expect(hit.status).toBe(200);
    expect(hit.headers.get('etag')).toBe(miss.headers.get('etag'));
    expect(await hit.json()).toEqual({
      data: { value: 7 },
      meta: {
        cache: 'HIT',
        fetchedAt: 900,
        requestId: 'request-2',
        source: 'fixture-provider',
      },
    });
    expect(loadCalls).toBe(1);
  });

  it('replaces a stale record after a successful refresh and serves the replacement as HIT', async () => {
    let now = 1_000;
    let value = 1;
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value }, source: 'fixture-provider', fetchedAt: now - 10 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);

    await handler(new Request('https://balance.test/api/fixture'), dependencies);
    now = 1_100;
    value = 2;
    const refreshed = await handler(new Request('https://balance.test/api/fixture'), dependencies);
    const hit = await handler(new Request('https://balance.test/api/fixture'), dependencies);

    await expect(refreshed.json()).resolves.toMatchObject({
      data: { value: 2 },
      meta: { cache: 'MISS', fetchedAt: 1_090, requestId: 'request-2' },
    });
    await expect(hit.json()).resolves.toMatchObject({
      data: { value: 2 },
      meta: { cache: 'HIT', fetchedAt: 1_090, requestId: 'request-3' },
    });
    expect(loadCalls).toBe(2);
  });

  it('serves the last positive record as explicit STALE when refresh has a transient upstream failure', async () => {
    let now = 1_000;
    let shouldFail = false;
    const route = createFixtureRoute(async () => {
      if (shouldFail) {
        throw new AppError('UPSTREAM_UNAVAILABLE');
      }

      return { kind: 'value', data: { value: 3 }, source: 'fixture-provider', fetchedAt: 950 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);
    const request = () => new Request('https://balance.test/api/fixture');
    const fresh = await handler(request(), dependencies);

    now = 1_100;
    shouldFail = true;
    const stale = await handler(request(), dependencies);

    expect(stale.status).toBe(200);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect(stale.headers.get('etag')).not.toBe(fresh.headers.get('etag'));
    await expect(stale.json()).resolves.toEqual({
      data: { value: 3 },
      meta: {
        cache: 'STALE',
        fetchedAt: 950,
        requestId: 'request-2',
        source: 'fixture-provider',
      },
    });

    const conditionalStale = await handler(
      new Request('https://balance.test/api/fixture', {
        headers: { 'If-None-Match': stale.headers.get('etag') ?? '' },
      }),
      dependencies,
    );

    expect(conditionalStale.status).toBe(200);
    expect(conditionalStale.headers.get('cache-control')).toBe('no-store');
    await expect(conditionalStale.json()).resolves.toMatchObject({ meta: { cache: 'STALE', requestId: 'request-3' } });
  });

  it('does not hide an unknown programmer error behind a stale response', async () => {
    let now = 1_000;
    let programmerError = false;
    const route = createFixtureRoute(async () => {
      if (programmerError) {
        throw new Error('unexpected implementation defect');
      }

      return { kind: 'value', data: { value: 22 }, source: 'fixture-provider', fetchedAt: 950 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);

    await handler(new Request('https://balance.test/api/fixture'), dependencies);
    now = 1_100;
    programmerError = true;
    const response = await handler(new Request('https://balance.test/api/fixture'), dependencies);

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL', requestId: 'request-2' },
    });
  });

  it.each(['network', 'raw-schema'] as const)(
    'maps an expected provider %s boundary failure to stale and counts it in the breaker',
    async (failureKind) => {
      let now = 1_000;
      let failing = false;
      let loadCalls = 0;
      const route = createFixtureRoute(async (_input, signal) => {
        loadCalls += 1;
        if (failing) {
          try {
            if (failureKind === 'network') {
              throw new TypeError('native fetch failed');
            }

            z.object({ ok: z.literal(true) }).parse({ ok: false });
          } catch (error) {
            rethrowAsUpstreamUnavailable(error, signal);
          }
        }

        return { kind: 'value', data: { value: 27 }, source: 'fixture-provider', fetchedAt: 950 };
      });
      const handler = createGatewayHandler(createRouteRegistry([route]));
      const dependencies = createDependencies(() => now);

      await handler(new Request('https://balance.test/api/fixture'), dependencies);
      now = 1_100;
      failing = true;
      const firstFailure = await handler(new Request('https://balance.test/api/fixture'), dependencies);
      const thresholdFailure = await handler(new Request('https://balance.test/api/fixture'), dependencies);
      const openBreaker = await handler(new Request('https://balance.test/api/fixture'), dependencies);

      for (const response of [firstFailure, thresholdFailure, openBreaker]) {
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(response.json()).resolves.toMatchObject({
          data: { value: 27 },
          meta: { cache: 'STALE' },
        });
      }
      expect(loadCalls).toBe(3);
    },
  );

  it('preserves MISSING_CREDENTIALS without stale fallback or breaker failure counting', async () => {
    let now = 1_000;
    let missingCredentials = false;
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      if (missingCredentials) {
        throw new AppError('MISSING_CREDENTIALS');
      }

      return { kind: 'value', data: { value: 28 }, source: 'fixture-provider', fetchedAt: 950 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);

    await handler(new Request('https://balance.test/api/fixture'), dependencies);
    now = 1_100;
    missingCredentials = true;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await handler(new Request('https://balance.test/api/fixture'), dependencies);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'MISSING_CREDENTIALS' } });
    }

    expect(loadCalls).toBe(4);
  });

  it('lets a coalesced follower retain stale data that the acquisition leader could not observe', async () => {
    const now = 1_100;
    const clock = () => now;
    const store = new MemoryFleetStateStore(clock);
    const cacheKey = createCacheKey('fixture', { region: 'seoul' });
    const loadStarted = deferred<void>();
    let rejectLoad!: (reason: unknown) => void;
    const route = createFixtureRoute(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
          loadStarted.resolve();
        }),
    );
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(clock, store);
    const coalescerSpy = vi.spyOn(dependencies.localCoalescer, 'run');

    const leaderResponse = handler(new Request('https://balance.test/api/fixture'), dependencies);
    await loadStarted.promise;
    await store.writeCache(
      cacheKey,
      {
        version: 1,
        kind: 'positive',
        data: { value: 15 },
        source: 'fixture-provider',
        fetchedAt: 900,
        storedAt: 900,
        freshUntil: 1_000,
        staleUntil: 1_600,
      },
      1_000,
    );

    const followerResponse = handler(new Request('https://balance.test/api/fixture'), dependencies);
    await vi.waitFor(() => expect(coalescerSpy).toHaveBeenCalledTimes(2));
    rejectLoad(new AppError('UPSTREAM_UNAVAILABLE'));

    const leader = await leaderResponse;
    const follower = await followerResponse;

    expect(leader.status).toBe(502);
    expect(follower.status).toBe(200);
    expect(follower.headers.get('cache-control')).toBe('no-store');
    await expect(follower.json()).resolves.toMatchObject({
      data: { value: 15 },
      meta: { cache: 'STALE', requestId: 'request-2' },
    });
  });

  it('applies origin admission before cache access and returns Retry-After on limit + 1', async () => {
    let loadCalls = 0;
    const clock = () => 1_000;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 5 }, source: 'fixture-provider', fetchedAt: 900 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(clock);

    for (let requestNumber = 0; requestNumber < profile.admissionRate.limit; requestNumber += 1) {
      const response = await handler(new Request('https://balance.test/api/fixture'), dependencies);
      expect(response.status).toBe(200);
    }

    const limited = await handler(new Request('https://balance.test/api/fixture'), dependencies);

    expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(limited.headers.get('retry-after')).toBe('1');
    await expect(limited.json()).resolves.toEqual({
      error: { code: 'RATE_LIMITED', requestId: 'request-21' },
    });
    expect(loadCalls).toBe(1);
  });

  it.each(['reject', 'deny'] as const)(
    'preserves the caller abort when a pending admission operation later %s',
    async (outcome) => {
      const clock = () => 1_000;
      const baseStore = new MemoryFleetStateStore(clock);
      const admissionStarted = deferred<void>();
      let resolveAdmission!: (value: FixedWindowConsumption) => void;
      let rejectAdmission!: (reason: unknown) => void;
      const pendingAdmission = new Promise<FixedWindowConsumption>((resolve, reject) => {
        resolveAdmission = resolve;
        rejectAdmission = reject;
      });
      const pendingStore = new Proxy(baseStore, {
        get(target, property, receiver) {
          if (property === 'consumeFixedWindow') {
            return () => {
              admissionStarted.resolve();
              return pendingAdmission;
            };
          }

          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const route = createFixtureRoute(async () => ({
        kind: 'value',
        data: { value: 26 },
        source: 'fixture-provider',
        fetchedAt: 990,
      }));
      const handler = createGatewayHandler(createRouteRegistry([route]));
      const caller = new AbortController();
      const reason = new Error('caller left during admission');
      const response = handler(
        new Request('https://balance.test/api/fixture', { signal: caller.signal }),
        createDependencies(clock, pendingStore),
      );

      await admissionStarted.promise;
      caller.abort(reason);
      if (outcome === 'reject') {
        rejectAdmission(new Error('admission store failed after disconnect'));
      } else {
        resolveAdmission({ allowed: false, count: 2, remaining: 0, resetAt: 2_000, retryAfterMs: 1_000 });
      }

      await expect(response).rejects.toBe(reason);
    },
  );

  it('coordinates two handler instances so a lease loser waits for the winner cache write', async () => {
    const clock = () => 1_000;
    const sharedStore = new MemoryFleetStateStore(clock);
    const leaseSpy = vi.spyOn(sharedStore, 'tryAcquireLease');
    const upstream = deferred<{
      kind: 'value';
      data: { value: number };
      source: string;
      fetchedAt: number;
    }>();
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return upstream.promise;
    });
    const registry = createRouteRegistry([route]);
    const firstHandler = createGatewayHandler(registry);
    const secondHandler = createGatewayHandler(registry);
    const firstDependencies = createDependencies(clock, sharedStore, 'a');
    const secondDependencies = {
      ...createDependencies(clock, sharedStore, 'b'),
      sleep: async () => {
        await Promise.resolve();
      },
    };

    const firstResponse = firstHandler(new Request('https://balance.test/api/fixture'), firstDependencies);
    while (loadCalls === 0) {
      await Promise.resolve();
    }

    const secondResponse = secondHandler(new Request('https://balance.test/api/fixture'), secondDependencies);
    while (leaseSpy.mock.calls.length < 2) {
      await Promise.resolve();
    }

    upstream.resolve({
      kind: 'value',
      data: { value: 11 },
      source: 'fixture-provider',
      fetchedAt: 975,
    });

    const [winner, follower] = await Promise.all([firstResponse, secondResponse]);

    expect(winner.status).toBe(200);
    expect(follower.status).toBe(200);
    await expect(follower.json()).resolves.toMatchObject({
      data: { value: 11 },
      meta: { cache: 'HIT', requestId: 'b-request-1' },
    });
    expect(loadCalls).toBe(1);
  });

  it('returns explicit empty outcomes without caching when negative caching is disabled', async () => {
    let loadCalls = 0;
    const clock = () => 1_000;
    const route = createFixtureRoute(
      async () => {
        loadCalls += 1;
        return { kind: 'empty', data: { value: 0 }, source: 'fixture-provider', fetchedAt: 990 };
      },
      createRouteProfile({ ...profile, negativeForMs: false }),
    );
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(clock);

    const first = await handler(new Request('https://balance.test/api/fixture'), dependencies);
    const second = await handler(new Request('https://balance.test/api/fixture'), dependencies);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ meta: { cache: 'MISS' } });
    await expect(second.json()).resolves.toMatchObject({ meta: { cache: 'MISS' } });
    expect(loadCalls).toBe(2);
  });

  it('fenced-deletes an older positive record after an authoritative empty with negative caching disabled', async () => {
    let now = 1_000;
    let outcome: 'value' | 'empty' | 'failure' = 'value';
    const route = createFixtureRoute(
      async () => {
        if (outcome === 'failure') {
          throw new AppError('UPSTREAM_UNAVAILABLE');
        }

        return {
          kind: outcome,
          data: { value: outcome === 'value' ? 21 : 0 },
          source: 'fixture-provider',
          fetchedAt: 990,
        };
      },
      createRouteProfile({ ...profile, negativeForMs: false }),
    );
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);

    const value = await handler(new Request('https://balance.test/api/fixture'), dependencies);
    now = 1_100;
    outcome = 'empty';
    const empty = await handler(new Request('https://balance.test/api/fixture'), dependencies);
    outcome = 'failure';
    const afterEmptyFailure = await handler(new Request('https://balance.test/api/fixture'), dependencies);

    expect(value.status).toBe(200);
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ data: { value: 0 }, meta: { cache: 'MISS' } });
    expect(afterEmptyFailure.status).toBe(502);
    await expect(afterEmptyFailure.json()).resolves.toMatchObject({
      error: { code: 'UPSTREAM_UNAVAILABLE' },
    });
  });

  it('aborts an overdue loader and returns a no-store UPSTREAM_UNAVAILABLE response', async () => {
    let deadline: (() => void) | undefined;
    let loaderSignal: AbortSignal | undefined;
    const clock = () => 1_000;
    const route = createFixtureRoute((_input, signal) => {
      loaderSignal = signal;
      return new Promise(() => undefined);
    }, profile);
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies: GatewayDependencies = {
      ...createDependencies(clock),
      scheduler: {
        clearTimeout() {},
        setTimeout(callback) {
          deadline = callback;
          return 'deadline';
        },
      },
    };

    const pending = handler(new Request('https://balance.test/api/fixture'), dependencies);
    while (deadline === undefined) {
      await Promise.resolve();
    }
    deadline();

    const response = await pending;

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(loaderSignal?.aborted).toBe(true);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UPSTREAM_UNAVAILABLE', requestId: 'request-1' },
    });
  });

  it('fails closed with SERVICE_UNAVAILABLE when the admission store is unavailable', async () => {
    const clock = () => 1_000;
    const baseStore = new MemoryFleetStateStore(clock);
    const unavailableStore = new Proxy(baseStore, {
      get(target, property, receiver) {
        if (property === 'consumeFixedWindow') {
          return async () => {
            throw new Error('store unavailable');
          };
        }

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const route = createFixtureRoute(async () => ({
      kind: 'value',
      data: { value: 1 },
      source: 'fixture-provider',
      fetchedAt: 900,
    }));
    const handler = createGatewayHandler(createRouteRegistry([route]));

    const response = await handler(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, unavailableStore),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', requestId: 'request-1' },
    });
  });

  it('serves stale instead of bypassing coordination when lease acquisition storage fails', async () => {
    let now = 1_000;
    const clock = () => now;
    const baseStore = new MemoryFleetStateStore(clock);
    const route = createFixtureRoute(async () => ({
      kind: 'value',
      data: { value: 4 },
      source: 'fixture-provider',
      fetchedAt: 925,
    }));
    const registry = createRouteRegistry([route]);
    const seed = await createGatewayHandler(registry)(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, baseStore, 'seed'),
    );
    expect(seed.status).toBe(200);
    now = 1_100;

    const leaseUnavailableStore = new Proxy(baseStore, {
      get(target, property, receiver) {
        if (property === 'tryAcquireLease') {
          return async () => {
            throw new Error('lease store unavailable');
          };
        }

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await createGatewayHandler(registry)(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, leaseUnavailableStore),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      data: { value: 4 },
      meta: { cache: 'STALE', requestId: 'request-1' },
    });
  });

  it('treats breaker storage as a hint and remains protected by lease, budget, and timeout', async () => {
    const clock = () => 1_000;
    const baseStore = new MemoryFleetStateStore(clock);
    const breakerUnavailableStore = new Proxy(baseStore, {
      get(target, property, receiver) {
        if (property === 'acquireBreaker') {
          return async () => {
            throw new Error('breaker store unavailable');
          };
        }

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 8 }, source: 'fixture-provider', fetchedAt: 940 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));

    const response = await handler(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, breakerUnavailableStore),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { value: 8 },
      meta: { cache: 'MISS' },
    });
    expect(loadCalls).toBe(1);
  });

  it('serves stale when upstream-budget storage fails instead of calling the provider unprotected', async () => {
    let now = 1_000;
    const clock = () => now;
    const baseStore = new MemoryFleetStateStore(clock);
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 6 }, source: 'fixture-provider', fetchedAt: 930 };
    });
    const registry = createRouteRegistry([route]);
    await createGatewayHandler(registry)(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, baseStore, 'seed'),
    );
    now = 1_100;
    let counterCalls = 0;
    const budgetUnavailableStore = new Proxy(baseStore, {
      get(target, property, receiver) {
        if (property === 'consumeFixedWindow') {
          return async (...args: Parameters<typeof baseStore.consumeFixedWindow>) => {
            counterCalls += 1;
            if (counterCalls === 2) {
              throw new Error('budget store unavailable');
            }
            return baseStore.consumeFixedWindow(...args);
          };
        }

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const response = await createGatewayHandler(registry)(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, budgetUnavailableStore),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { value: 6 },
      meta: { cache: 'STALE', requestId: 'request-1' },
    });
    expect(loadCalls).toBe(1);
  });

  it('returns SERVICE_UNAVAILABLE without calling the provider when its upstream budget is exhausted and no stale exists', async () => {
    const clock = () => 1_000;
    const store = new MemoryFleetStateStore(clock);
    const limitedProfile = createRouteProfile({
      ...profile,
      upstreamBudget: { ...profile.upstreamBudget, limit: 1 },
    });
    await store.consumeFixedWindow(
      createStateKey('rate', limitedProfile.upstreamBudget.scope),
      limitedProfile.upstreamBudget,
    );
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 24 }, source: 'fixture-provider', fetchedAt: 990 };
    }, limitedProfile);
    const handler = createGatewayHandler(createRouteRegistry([route]));

    const response = await handler(new Request('https://balance.test/api/fixture'), createDependencies(clock, store));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', requestId: 'request-1' },
    });
    expect(loadCalls).toBe(0);
  });

  it.each(['writeCacheIfLeaseOwner', 'completeBreaker', 'releaseLease'] as const)(
    'keeps a valid upstream response when best-effort %s persistence fails',
    async (failingOperation) => {
      const degradedPhaseByOperation = {
        writeCacheIfLeaseOwner: 'cache-write',
        completeBreaker: 'breaker-complete',
        releaseLease: 'lease-release',
      } as const;
      const clock = () => 1_000;
      const baseStore = new MemoryFleetStateStore(clock);
      const events: GatewayLogEvent[] = [];
      const degradedStore = new Proxy(baseStore, {
        get(target, property, receiver) {
          if (property === failingOperation) {
            return async () => {
              throw new Error(`${failingOperation} unavailable`);
            };
          }

          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const route = createFixtureRoute(async () => ({
        kind: 'value',
        data: { value: 12 },
        source: 'fixture-provider',
        fetchedAt: 980,
      }));
      const handler = createGatewayHandler(createRouteRegistry([route]));
      const dependencies = {
        ...createDependencies(clock, degradedStore),
        logger: (event: GatewayLogEvent) => {
          events.push(event);
        },
      };

      const response = await handler(new Request('https://balance.test/api/fixture'), dependencies);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { value: 12 },
        meta: { cache: 'MISS', requestId: 'request-1' },
      });
      expect(events).toContainEqual({
        event: 'gateway.degraded',
        route: 'fixture',
        phase: degradedPhaseByOperation[failingOperation],
        outcome: 'failure',
        durationMs: 0,
        requestId: 'request-1',
      });
    },
  );

  it.each([2, 3])(
    'retains an already validated stale record when cache coordination read #%i fails',
    async (failingRead) => {
      let now = 1_000;
      const clock = () => now;
      const baseStore = new MemoryFleetStateStore(clock);
      let loadCalls = 0;
      const route = createFixtureRoute(async () => {
        loadCalls += 1;
        return { kind: 'value', data: { value: 14 }, source: 'fixture-provider', fetchedAt: 940 };
      });
      const handler = createGatewayHandler(createRouteRegistry([route]));

      await handler(new Request('https://balance.test/api/fixture'), createDependencies(clock, baseStore, 'seed'));
      now = 1_100;
      let readCalls = 0;
      const intermittentlyUnreadableStore = new Proxy(baseStore, {
        get(target, property, receiver) {
          if (property === 'readCache') {
            return async (...args: Parameters<typeof baseStore.readCache>) => {
              readCalls += 1;
              if (readCalls === failingRead) {
                throw new Error('cache read unavailable');
              }

              return baseStore.readCache(...args);
            };
          }

          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      const response = await handler(
        new Request('https://balance.test/api/fixture'),
        createDependencies(clock, intermittentlyUnreadableStore),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toMatchObject({
        data: { value: 14 },
        meta: { cache: 'STALE', requestId: 'request-1' },
      });
      expect(loadCalls).toBe(1);
    },
  );

  it('retains stale found by the acquisition when the post-lease cache read fails', async () => {
    let now = 1_000;
    const clock = () => now;
    const baseStore = new MemoryFleetStateStore(clock);
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 23 }, source: 'fixture-provider', fetchedAt: 940 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));

    await handler(new Request('https://balance.test/api/fixture'), createDependencies(clock, baseStore, 'seed'));
    now = 1_100;
    let readCalls = 0;
    const eventuallyConsistentStore = new Proxy(baseStore, {
      get(target, property, receiver) {
        if (property === 'readCache') {
          return async (...args: Parameters<typeof baseStore.readCache>) => {
            readCalls += 1;
            if (readCalls === 1) {
              return null;
            }
            if (readCalls === 3) {
              throw new Error('cache read unavailable');
            }

            return baseStore.readCache(...args);
          };
        }

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const response = await handler(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, eventuallyConsistentStore),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      data: { value: 23 },
      meta: { cache: 'STALE', requestId: 'request-1' },
    });
    expect(loadCalls).toBe(1);
  });

  it('does not bypass cache coordination when the cache read fails', async () => {
    const clock = () => 1_000;
    const baseStore = new MemoryFleetStateStore(clock);
    const unreadableStore = new Proxy(baseStore, {
      get(target, property, receiver) {
        if (property === 'readCache') {
          return async () => {
            throw new Error('cache read unavailable');
          };
        }

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 1 }, source: 'fixture-provider', fetchedAt: 900 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));

    const response = await handler(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, unreadableStore),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', requestId: 'request-1' },
    });
    expect(loadCalls).toBe(0);
  });

  it('keeps the HALF_OPEN ownership lease beyond the probe deadline for completion safety', async () => {
    const clock = () => 1_000;
    const store = new MemoryFleetStateStore(clock);
    const breakerSpy = vi.spyOn(store, 'acquireBreaker');
    const route = createFixtureRoute(async () => ({
      kind: 'value',
      data: { value: 2 },
      source: 'fixture-provider',
      fetchedAt: 900,
    }));

    await createGatewayHandler(createRouteRegistry([route]))(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, store),
    );

    expect(breakerSpy).toHaveBeenCalledOnce();
    expect(breakerSpy.mock.calls[0]?.[2]).toMatchObject({
      closedCompletionBoundMs: profile.upstreamTimeoutMs + profile.lockSafetyMs,
      halfOpenLeaseMs: Math.min(profile.upstreamTimeoutMs, profile.breaker.probeTimeoutMs) + profile.lockSafetyMs,
      stateRetentionMs:
        Math.max(
          profile.breaker.failureWindowMs,
          profile.breaker.cooldownMs,
          profile.upstreamTimeoutMs + profile.lockSafetyMs,
          Math.min(profile.upstreamTimeoutMs, profile.breaker.probeTimeoutMs) + profile.lockSafetyMs,
        ) + profile.lockSafetyMs,
    });
  });

  it('does not serve a stale candidate that reaches hard expiry during refresh', async () => {
    let now = 1_000;
    let expireDuringRefresh = false;
    const route = createFixtureRoute(async () => {
      if (expireDuringRefresh) {
        now = 1_600;
        throw new AppError('UPSTREAM_UNAVAILABLE');
      }

      return { kind: 'value', data: { value: 10 }, source: 'fixture-provider', fetchedAt: 950 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);
    await handler(new Request('https://balance.test/api/fixture'), dependencies);

    now = 1_599;
    expireDuringRefresh = true;
    const response = await handler(new Request('https://balance.test/api/fixture'), dependencies);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UPSTREAM_UNAVAILABLE', requestId: 'request-2' },
    });
  });

  it('keeps an exhausted-budget stale response when breaker neutral persistence fails', async () => {
    let now = 1_000;
    const clock = () => now;
    const store = new MemoryFleetStateStore(clock);
    const limitedProfile = createRouteProfile({
      ...profile,
      upstreamBudget: { ...profile.upstreamBudget, limit: 1 },
    });
    const route = createFixtureRoute(
      async () => ({
        kind: 'value',
        data: { value: 13 },
        source: 'fixture-provider',
        fetchedAt: 960,
      }),
      limitedProfile,
    );
    const registry = createRouteRegistry([route]);
    await createGatewayHandler(registry)(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, store, 'seed'),
    );
    now = 1_100;
    const breakerWriteUnavailable = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'completeBreaker') {
          return async () => {
            throw new Error('breaker write unavailable');
          };
        }

        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const response = await createGatewayHandler(registry)(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock, breakerWriteUnavailable),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { value: 13 },
      meta: { cache: 'STALE' },
    });
  });

  it('emits one allowlisted completion event without raw URL, identity, or provider details', async () => {
    const events: GatewayLogEvent[] = [];
    const clock = () => 1_000;
    const route = createFixtureRoute(async () => ({
      kind: 'value',
      data: { value: 15 },
      source: 'provider-name-is-not-a-log-field',
      fetchedAt: 970,
    }));
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies: GatewayDependencies = {
      ...createDependencies(clock),
      logger: (event) => {
        events.push(event);
      },
    };

    const response = await handler(
      new Request('https://balance.test/api/fixture?providerKey=super-secret'),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        event: 'gateway.request',
        route: 'fixture',
        phase: 'response',
        outcome: 'success',
        durationMs: 0,
        requestId: 'request-1',
        cacheStatus: 'MISS',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(JSON.stringify(events)).not.toContain('provider-name');
    expect(JSON.stringify(events)).not.toContain('opaque-client-a');
  });

  it('logs a safe error code for an unmatched request without exposing its path', async () => {
    const events: GatewayLogEvent[] = [];
    const clock = () => 1_000;
    const dependencies: GatewayDependencies = {
      ...createDependencies(clock),
      logger: (event) => {
        events.push(event);
      },
    };

    const response = await createGatewayHandler(createRouteRegistry([]))(
      new Request('https://balance.test/api/private-secret?token=secret'),
      dependencies,
    );

    expect(response.status).toBe(404);
    expect(events).toEqual([
      {
        event: 'gateway.request',
        route: 'unmatched',
        phase: 'response',
        outcome: 'error',
        durationMs: 0,
        requestId: 'request-1',
        errorCode: 'NOT_FOUND',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('treats schema-valid non-JSON provider data as an upstream normalization failure', async () => {
    const clock = () => 1_000;
    const bigintRoute: GatewayRoute = {
      id: 'bigint-fixture',
      path: '/api/bigint-fixture',
      dataSchema: z.bigint(),
      profile: createRouteProfile({
        ...profile,
        admissionRate: { ...profile.admissionRate, scope: 'route.bigint-fixture' },
      }),
      parseRequest: () => ({
        input: undefined,
        publicCacheIdentity: {},
        admissionSubject: createAdmissionSubject('opaque-client-a'),
      }),
      load: async () => ({
        kind: 'value',
        data: 1n,
        source: 'fixture-provider',
        fetchedAt: 990,
      }),
    };

    const response = await createGatewayHandler(createRouteRegistry([bigintRoute]))(
      new Request('https://balance.test/api/bigint-fixture'),
      createDependencies(clock),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UPSTREAM_UNAVAILABLE', requestId: 'request-1' },
    });
  });

  it('caches explicit empty outcomes only until the exact negative-cache boundary', async () => {
    let now = 1_000;
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'empty', data: { value: 0 }, source: 'fixture-provider', fetchedAt: 995 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);

    const miss = await handler(new Request('https://balance.test/api/fixture'), dependencies);
    now = 1_049;
    const hit = await handler(new Request('https://balance.test/api/fixture'), dependencies);
    now = 1_050;
    const expired = await handler(new Request('https://balance.test/api/fixture'), dependencies);

    await expect(miss.json()).resolves.toMatchObject({ meta: { cache: 'MISS' } });
    await expect(hit.json()).resolves.toMatchObject({ meta: { cache: 'HIT' } });
    await expect(expired.json()).resolves.toMatchObject({ meta: { cache: 'MISS' } });
    expect(loadCalls).toBe(2);
  });

  it('returns a bodyless 304 only for a matching current representation', async () => {
    const clock = () => 1_000;
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 16 }, source: 'fixture-provider', fetchedAt: 980 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(clock);
    const current = await handler(new Request('https://balance.test/api/fixture'), dependencies);
    const etag = current.headers.get('etag');
    expect(etag).not.toBeNull();

    const revalidated = await handler(
      new Request('https://balance.test/api/fixture', {
        headers: { 'If-None-Match': etag?.replace('W/', '') ?? '' },
      }),
      dependencies,
    );

    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe('');
    expect(revalidated.headers.get('etag')).toBe(etag);
    expect(revalidated.headers.get('x-request-id')).toBe('request-2');
    expect(loadCalls).toBe(1);
  });

  it('opens after the transient failure threshold and admits one recovery probe at cooldown', async () => {
    let now = 1_000;
    let failing = true;
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      if (failing) {
        throw new AppError('UPSTREAM_UNAVAILABLE');
      }
      return { kind: 'value', data: { value: 17 }, source: 'fixture-provider', fetchedAt: 1_090 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(() => now);

    expect((await handler(new Request('https://balance.test/api/fixture'), dependencies)).status).toBe(502);
    expect((await handler(new Request('https://balance.test/api/fixture'), dependencies)).status).toBe(502);
    expect((await handler(new Request('https://balance.test/api/fixture'), dependencies)).status).toBe(503);
    expect(loadCalls).toBe(2);

    now = 1_100;
    failing = false;
    const recovered = await handler(new Request('https://balance.test/api/fixture'), dependencies);

    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({
      data: { value: 17 },
      meta: { cache: 'MISS' },
    });
    expect(loadCalls).toBe(3);
  });

  it('isolates a caller abort from a shared local acquisition and preserves the original reason', async () => {
    const clock = () => 1_000;
    const upstream = deferred<{
      kind: 'value';
      data: { value: number };
      source: string;
      fetchedAt: number;
    }>();
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return upstream.promise;
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(clock);
    const caller = new AbortController();
    const abortReason = new Error('caller disconnected');
    const first = handler(new Request('https://balance.test/api/fixture'), dependencies);
    const aborted = handler(new Request('https://balance.test/api/fixture', { signal: caller.signal }), dependencies);

    while (loadCalls === 0) {
      await Promise.resolve();
    }
    caller.abort(abortReason);
    upstream.resolve({
      kind: 'value',
      data: { value: 18 },
      source: 'fixture-provider',
      fetchedAt: 990,
    });

    await expect(aborted).rejects.toBe(abortReason);
    const response = await first;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { value: 18 },
      meta: { requestId: 'request-1' },
    });
    expect(loadCalls).toBe(1);
  });

  it.each([
    ['invalid', { version: 999 }],
    [
      'expired',
      {
        version: 1,
        kind: 'positive',
        data: { value: -1 },
        source: 'old-fixture',
        fetchedAt: 700,
        storedAt: 700,
        freshUntil: 800,
        staleUntil: 900,
      },
    ],
  ] as const)(
    'does not let a late %s-cache reader delete a newer fenced write from another instance',
    async (_case, oldRecord) => {
      const clock = () => 1_000;
      const store = new MemoryFleetStateStore(clock);
      const cacheKey = createCacheKey('fixture', { region: 'seoul' });
      await store.writeCache(cacheKey, oldRecord, 1_000);
      const staleReadCaptured = deferred<void>();
      const releaseStaleRead = deferred<void>();
      let delayedReads = 0;
      const delayedReaderStore = new Proxy(store, {
        get(target, property, receiver) {
          if (property === 'readCache') {
            return async (...args: Parameters<typeof store.readCache>) => {
              const captured = await store.readCache(...args);
              delayedReads += 1;
              if (delayedReads === 1) {
                staleReadCaptured.resolve();
                await releaseStaleRead.promise;
              }

              return captured;
            };
          }

          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      let loadCalls = 0;
      const route = createFixtureRoute(async () => {
        loadCalls += 1;
        return { kind: 'value', data: { value: 25 }, source: 'fixture-provider', fetchedAt: 990 };
      });
      const handler = createGatewayHandler(createRouteRegistry([route]));
      const oldReader = new AbortController();
      const abortReason = new Error('old reader disconnected');
      const oldResponse = handler(
        new Request('https://balance.test/api/fixture', { signal: oldReader.signal }),
        createDependencies(clock, delayedReaderStore, 'old'),
      );

      await staleReadCaptured.promise;
      const writer = await handler(
        new Request('https://balance.test/api/fixture'),
        createDependencies(clock, store, 'writer'),
      );
      expect(writer.status).toBe(200);
      oldReader.abort(abortReason);
      releaseStaleRead.resolve();
      await expect(oldResponse).rejects.toBe(abortReason);

      const follower = await handler(
        new Request('https://balance.test/api/fixture'),
        createDependencies(clock, store, 'follower'),
      );

      await expect(follower.json()).resolves.toMatchObject({
        data: { value: 25 },
        meta: { cache: 'HIT' },
      });
      expect(loadCalls).toBe(1);
    },
  );

  it('treats a corrupt cache record as a miss and replaces it under the lease without an unfenced delete', async () => {
    const clock = () => 1_000;
    const store = new MemoryFleetStateStore(clock);
    const cacheKey = createCacheKey('fixture', { region: 'seoul' });
    await store.writeCache(cacheKey, { version: 999, rawSecret: 'must-not-escape' }, 1_000);
    const deleteSpy = vi.spyOn(store, 'deleteCache');
    let loadCalls = 0;
    const route = createFixtureRoute(async () => {
      loadCalls += 1;
      return { kind: 'value', data: { value: 19 }, source: 'fixture-provider', fetchedAt: 990 };
    });
    const handler = createGatewayHandler(createRouteRegistry([route]));

    const response = await handler(new Request('https://balance.test/api/fixture'), createDependencies(clock, store));

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('must-not-escape');
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(loadCalls).toBe(1);
  });

  it('rejects an already-aborted cache HIT with the original reason before consuming admission', async () => {
    const clock = () => 1_000;
    const store = new MemoryFleetStateStore(clock);
    const route = createFixtureRoute(async () => ({
      kind: 'value',
      data: { value: 20 },
      source: 'fixture-provider',
      fetchedAt: 990,
    }));
    const handler = createGatewayHandler(createRouteRegistry([route]));
    const dependencies = createDependencies(clock, store);
    await handler(new Request('https://balance.test/api/fixture'), dependencies);
    const admissionSpy = vi.spyOn(store, 'consumeFixedWindow');
    const caller = new AbortController();
    const reason = new Error('already disconnected');
    caller.abort(reason);

    const aborted = handler(new Request('https://balance.test/api/fixture', { signal: caller.signal }), dependencies);

    await expect(aborted).rejects.toBe(reason);
    expect(admissionSpy).not.toHaveBeenCalled();
  });

  it('rejects a route schema that mutates wire data instead of normalizing in the loader', async () => {
    const clock = () => 1_000;
    const transformingRoute: GatewayRoute = {
      id: 'transforming-fixture',
      path: '/api/transforming-fixture',
      dataSchema: z.number().transform((value) => value + 1),
      profile: createRouteProfile({
        ...profile,
        admissionRate: { ...profile.admissionRate, scope: 'route.transforming-fixture' },
      }),
      parseRequest: () => ({
        input: undefined,
        publicCacheIdentity: {},
        admissionSubject: createAdmissionSubject('opaque-client-a'),
      }),
      load: async () => ({
        kind: 'value',
        data: 1,
        source: 'fixture-provider',
        fetchedAt: 990,
      }),
    };

    const response = await createGatewayHandler(createRouteRegistry([transformingRoute]))(
      new Request('https://balance.test/api/transforming-fixture'),
      createDependencies(clock),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UPSTREAM_UNAVAILABLE', requestId: 'request-1' },
    });
  });

  it('normalizes a structurally malformed loader result to UPSTREAM_UNAVAILABLE', async () => {
    const clock = () => 1_000;
    const route = createFixtureRoute(async () => null as never);

    const response = await createGatewayHandler(createRouteRegistry([route]))(
      new Request('https://balance.test/api/fixture'),
      createDependencies(clock),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UPSTREAM_UNAVAILABLE', requestId: 'request-1' },
    });
  });
});
