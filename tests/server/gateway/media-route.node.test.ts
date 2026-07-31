// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createStateKey, MemoryFleetStateStore } from '../../../src/server/cache';
import {
  createAdmissionSubject,
  createGatewayHandler,
  createRouteProfile,
  createRouteRegistry,
  type GatewayDependencies,
  type GatewayMediaRoute,
} from '../../../src/server/gateway';
import { createLocalCoalescer } from '../../../src/server/resilience';
import { AppError } from '../../../src/shared/contracts';

const profile = createRouteProfile({
  freshForMs: 1_000,
  staleIfErrorForMs: 1_000,
  negativeForMs: false,
  upstreamTimeoutMs: 750,
  lockWaitMs: 250,
  lockPollMs: 25,
  lockSafetyMs: 100,
  admissionRate: { limit: 2, windowMs: 60_000, scope: 'route.media-fixture' },
  upstreamBudget: { limit: 2, windowMs: 60_000, scope: 'provider.media-fixture' },
  breaker: {
    scope: 'provider.media-fixture',
    failureThreshold: 2,
    failureWindowMs: 30_000,
    cooldownMs: 15_000,
    probeTimeoutMs: 500,
  },
  cdnMaxAgeSeconds: 60,
});

const createDependencies = (
  store: MemoryFleetStateStore,
  logger?: GatewayDependencies['logger'],
): GatewayDependencies => ({
  clock: () => 1_000,
  createCoordinationToken: () => 'media-coordination-token',
  createRequestId: () => 'media-request-id',
  fleetStateStore: store,
  localCoalescer: createLocalCoalescer<string>(),
  ...(logger === undefined ? {} : { logger }),
});

const createMediaRoute = (load: GatewayMediaRoute['load'], routeProfile = profile): GatewayMediaRoute => ({
  kind: 'media',
  id: 'media-fixture',
  path: '/api/media-fixture',
  profile: routeProfile,
  parseRequest: () => ({
    admissionSubject: createAdmissionSubject('opaque-media-client'),
    input: undefined,
    publicCacheIdentity: { cameraId: 'opaque-camera-id' },
  }),
  load,
});

describe('coarse gateway media route', () => {
  it('returns validated binary success without touching the JSON cache path', async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const store = new MemoryFleetStateStore(() => 1_000);
    const readCache = vi.spyOn(store, 'readCache');
    const writeCache = vi.spyOn(store, 'writeCacheIfLeaseOwner');
    const logs: unknown[] = [];
    const route = createMediaRoute(async () => ({
      body: bytes,
      contentType: 'image/jpeg',
      fetchedAt: 990,
      kind: 'media',
      source: 'provider-value-must-not-leak',
    }));

    const response = await createGatewayHandler(createRouteRegistry([route]))(
      new Request('https://balance.test/api/media-fixture'),
      createDependencies(store, (event) => {
        logs.push(event);
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('x-request-id')).toBe('media-request-id');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(readCache).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain('provider-value');
    expect(JSON.stringify(logs)).not.toContain('opaque-camera-id');
  });

  it('fails closed with the JSON error envelope when a media route exceeds the central byte cap', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    const route = createMediaRoute(async () => ({
      body: new Uint8Array(512 * 1_024 + 1),
      contentType: 'image/jpeg',
      fetchedAt: 990,
      kind: 'media',
      source: 'fixture-provider',
    }));

    const response = await createGatewayHandler(createRouteRegistry([route]))(
      new Request('https://balance.test/api/media-fixture'),
      createDependencies(store),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UPSTREAM_UNAVAILABLE', requestId: 'media-request-id' },
    });
  });

  it('applies admission before any media acquisition', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    const load = vi.fn(async () => ({
      body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: 'image/jpeg' as const,
      fetchedAt: 990,
      kind: 'media' as const,
      source: 'fixture-provider',
    }));
    const handler = createGatewayHandler(createRouteRegistry([createMediaRoute(load)]));
    const request = () => new Request('https://balance.test/api/media-fixture');

    expect((await handler(request(), createDependencies(store))).status).toBe(200);
    expect((await handler(request(), createDependencies(store))).status).toBe(200);
    const rejected = await handler(request(), createDependencies(store));

    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('retry-after')).toBe('60');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('aborts the actual upstream acquisition when its only caller disconnects', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    let upstreamSignal: AbortSignal | undefined;
    let releaseUpstream: (() => void) | undefined;
    const load = vi.fn(
      async (_input: unknown, signal: AbortSignal) =>
        new Promise<{
          body: Uint8Array;
          contentType: 'image/jpeg';
          fetchedAt: number;
          kind: 'media';
          source: string;
        }>((resolve) => {
          upstreamSignal = signal;
          releaseUpstream = () =>
            resolve({
              body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
              contentType: 'image/jpeg',
              fetchedAt: 990,
              kind: 'media',
              source: 'fixture-provider',
            });
        }),
    );
    const handler = createGatewayHandler(createRouteRegistry([createMediaRoute(load)]));
    const caller = new AbortController();
    const reason = new Error('media viewer closed');
    const pending = handler(
      new Request('https://balance.test/api/media-fixture', { signal: caller.signal }),
      createDependencies(store),
    );

    while (upstreamSignal === undefined) {
      await Promise.resolve();
    }
    caller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(upstreamSignal.aborted).toBe(true);
    expect(upstreamSignal.reason).toBe(reason);
    releaseUpstream?.();
  });

  it('rejects an exhausted media provider budget without calling the loader', async () => {
    const limitedProfile = createRouteProfile({
      ...profile,
      admissionRate: { ...profile.admissionRate, limit: 3 },
      upstreamBudget: { ...profile.upstreamBudget, limit: 1, windowMs: 100 },
    });
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    await store.consumeFixedWindow(
      createStateKey('rate', limitedProfile.upstreamBudget.scope),
      limitedProfile.upstreamBudget,
    );
    const load = vi.fn(async () => ({
      body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: 'image/jpeg' as const,
      fetchedAt: now,
      kind: 'media' as const,
      source: 'fixture-provider',
    }));
    const handler = createGatewayHandler(createRouteRegistry([createMediaRoute(load, limitedProfile)]));
    const dependencies = {
      ...createDependencies(store),
      clock: () => now,
    };

    const rejected = await handler(new Request('https://balance.test/api/media-fixture'), dependencies);
    now += limitedProfile.upstreamBudget.windowMs;
    const recovered = await handler(new Request('https://balance.test/api/media-fixture'), dependencies);

    expect(rejected.status).toBe(503);
    await expect(rejected.json()).resolves.toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', requestId: 'media-request-id' },
    });
    expect(recovered.status).toBe(200);
    expect(load).toHaveBeenCalledOnce();
  });

  it('reserves the configured upstream call cost before invoking an uncached media loader', async () => {
    const weightedProfile = createRouteProfile({
      ...profile,
      admissionRate: { ...profile.admissionRate, limit: 3 },
      upstreamBudget: { ...profile.upstreamBudget, limit: 5 },
      upstreamBudgetCost: 3,
    });
    const store = new MemoryFleetStateStore(() => 1_000);
    await store.consumeFixedWindow(
      createStateKey('rate', weightedProfile.upstreamBudget.scope),
      weightedProfile.upstreamBudget,
      3,
    );
    const load = vi.fn(async () => ({
      body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: 'image/jpeg' as const,
      fetchedAt: 1_000,
      kind: 'media' as const,
      source: 'fixture-provider',
    }));
    const handler = createGatewayHandler(createRouteRegistry([createMediaRoute(load, weightedProfile)]));

    const response = await handler(new Request('https://balance.test/api/media-fixture'), createDependencies(store));

    expect(response.status).toBe(503);
    expect(load).not.toHaveBeenCalled();
  });

  it('opens the media breaker after transient failures and recovers through one half-open probe', async () => {
    const resilientProfile = createRouteProfile({
      ...profile,
      admissionRate: { ...profile.admissionRate, limit: 10 },
      upstreamBudget: { ...profile.upstreamBudget, limit: 10 },
    });
    let now = 1_000;
    const store = new MemoryFleetStateStore(() => now);
    const load = vi.fn(async () => {
      if (load.mock.calls.length <= resilientProfile.breaker.failureThreshold) {
        throw new AppError('UPSTREAM_UNAVAILABLE');
      }
      return {
        body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
        contentType: 'image/jpeg' as const,
        fetchedAt: now,
        kind: 'media' as const,
        source: 'fixture-provider',
      };
    });
    const handler = createGatewayHandler(createRouteRegistry([createMediaRoute(load, resilientProfile)]));
    const dependencies = {
      ...createDependencies(store),
      clock: () => now,
    };
    const request = () => new Request('https://balance.test/api/media-fixture');

    expect((await handler(request(), dependencies)).status).toBe(502);
    expect((await handler(request(), dependencies)).status).toBe(502);
    expect((await handler(request(), dependencies)).status).toBe(503);
    expect(load).toHaveBeenCalledTimes(2);

    now += resilientProfile.breaker.cooldownMs;
    expect((await handler(request(), dependencies)).status).toBe(200);
    expect((await handler(request(), dependencies)).status).toBe(200);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('aborts an overdue media loader and counts the timeout as a breaker failure', async () => {
    let deadline: (() => void) | undefined;
    let loaderSignal: AbortSignal | undefined;
    const store = new MemoryFleetStateStore(() => 1_000);
    const completeBreaker = vi.spyOn(store, 'completeBreaker');
    const route = createMediaRoute(
      async (_input, signal) =>
        new Promise(() => {
          loaderSignal = signal;
        }),
    );
    const dependencies: GatewayDependencies = {
      ...createDependencies(store),
      scheduler: {
        clearTimeout() {},
        setTimeout(callback) {
          deadline = callback;
          return 'media-deadline';
        },
      },
    };
    const pending = createGatewayHandler(createRouteRegistry([route]))(
      new Request('https://balance.test/api/media-fixture'),
      dependencies,
    );

    while (deadline === undefined) {
      await Promise.resolve();
    }
    deadline();
    const response = await pending;

    expect(response.status).toBe(502);
    expect(loaderSignal?.aborted).toBe(true);
    expect(loaderSignal?.reason).toMatchObject({
      name: 'GatewayTimeoutError',
      timeoutMs: profile.upstreamTimeoutMs,
    });
    expect(completeBreaker).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 'FAILURE', expect.any(Object));
  });

  it('coalesces the same media key while keeping the shared acquisition alive for a remaining caller', async () => {
    const coalescedProfile = createRouteProfile({
      ...profile,
      admissionRate: { ...profile.admissionRate, limit: 3 },
      upstreamBudget: { ...profile.upstreamBudget, limit: 1 },
    });
    const store = new MemoryFleetStateStore(() => 1_000);
    const acquireBreaker = vi.spyOn(store, 'acquireBreaker');
    let loaderSignal: AbortSignal | undefined;
    let resolveLoader: (() => void) | undefined;
    const load = vi.fn(
      async (_input: unknown, signal: AbortSignal) =>
        new Promise<{
          body: Uint8Array;
          contentType: 'image/jpeg';
          fetchedAt: number;
          kind: 'media';
          source: string;
        }>((resolve) => {
          loaderSignal = signal;
          resolveLoader = () =>
            resolve({
              body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
              contentType: 'image/jpeg',
              fetchedAt: 990,
              kind: 'media',
              source: 'fixture-provider',
            });
        }),
    );
    const handler = createGatewayHandler(createRouteRegistry([createMediaRoute(load, coalescedProfile)]));
    const dependencies = createDependencies(store);
    const runAbortable = vi.spyOn(dependencies.localCoalescer, 'runAbortable');
    const firstCaller = new AbortController();
    const reason = new Error('first viewer closed');
    const first = handler(
      new Request('https://balance.test/api/media-fixture', { signal: firstCaller.signal }),
      dependencies,
    );
    const second = handler(new Request('https://balance.test/api/media-fixture'), dependencies);

    await vi.waitFor(() => {
      expect(runAbortable).toHaveBeenCalledTimes(2);
      expect(loaderSignal).toBeDefined();
    });
    firstCaller.abort(reason);

    await expect(first).rejects.toBe(reason);
    expect(loaderSignal?.aborted).toBe(false);
    resolveLoader?.();
    expect((await second).status).toBe(200);
    expect(load).toHaveBeenCalledOnce();
    expect(acquireBreaker).toHaveBeenCalledOnce();
  });
});
