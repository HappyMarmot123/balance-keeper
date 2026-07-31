// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MemoryFleetStateStore } from '../../../src/server/cache';
import {
  createAdmissionSubject,
  createGatewayHandler,
  createRouteProfile,
  createRouteRegistry,
  type GatewayDependencies,
  type GatewayNoStoreRoute,
} from '../../../src/server/gateway';
import { createLocalCoalescer } from '../../../src/server/resilience';

const dataSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

const profile = createRouteProfile({
  freshForMs: 1,
  staleIfErrorForMs: 1,
  negativeForMs: false,
  upstreamTimeoutMs: 750,
  lockWaitMs: 1,
  lockPollMs: 1,
  lockSafetyMs: 100,
  admissionRate: { limit: 2, windowMs: 60_000, scope: 'route.redirect-fixture' },
  upstreamBudget: { limit: 2, windowMs: 60_000, scope: 'provider.redirect-fixture' },
  breaker: {
    scope: 'provider.redirect-fixture',
    failureThreshold: 2,
    failureWindowMs: 30_000,
    cooldownMs: 15_000,
    probeTimeoutMs: 500,
  },
  cdnMaxAgeSeconds: 1,
});

const createDependencies = (
  store: MemoryFleetStateStore,
  logger?: GatewayDependencies['logger'],
): GatewayDependencies => ({
  clock: () => 1_000,
  createCoordinationToken: () => 'redirect-coordination-token',
  createRequestId: () => 'redirect-request-id',
  fleetStateStore: store,
  localCoalescer: createLocalCoalescer<string>(),
  ...(logger === undefined ? {} : { logger }),
});

const createNoStoreRoute = (url: string): GatewayNoStoreRoute<undefined, { cameraId: string }, typeof dataSchema> => ({
  kind: 'no-store',
  dataSchema,
  id: 'no-store-fixture',
  path: '/api/no-store-fixture',
  profile,
  parseRequest: () => ({
    admissionSubject: createAdmissionSubject('opaque-no-store-client'),
    input: undefined,
    publicCacheIdentity: { cameraId: 'opaque-camera-id' },
  }),
  async load() {
    return {
      data: { url },
      fetchedAt: 990,
      kind: 'value',
      source: 'provider-value-must-not-leak',
    };
  },
});

describe('coarse gateway no-store route', () => {
  it('returns a validated no-store envelope without touching the fleet JSON cache path', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    const readCache = vi.spyOn(store, 'readCache');
    const writeCache = vi.spyOn(store, 'writeCacheIfLeaseOwner');
    const logs: unknown[] = [];

    const response = await createGatewayHandler(
      createRouteRegistry([createNoStoreRoute('https://media.example.test/live/stream')]),
    )(
      new Request('https://balance.test/api/no-store-fixture'),
      createDependencies(store, (event) => {
        logs.push(event);
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('x-request-id')).toBe('redirect-request-id');
    await expect(response.json()).resolves.toEqual({
      data: { url: 'https://media.example.test/live/stream' },
      meta: {
        cache: 'MISS',
        fetchedAt: 990,
        requestId: 'redirect-request-id',
        source: 'provider-value-must-not-leak',
      },
    });
    expect(readCache).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain('media.example.test');
    expect(JSON.stringify(logs)).not.toContain('provider-value');
    expect(JSON.stringify(logs)).not.toContain('opaque-camera-id');
  });

  it('fails closed when the loader returns data outside the route schema', async () => {
    const store = new MemoryFleetStateStore(() => 1_000);
    const route = createNoStoreRoute('not-a-url');
    const response = await createGatewayHandler(createRouteRegistry([route]))(
      new Request('https://balance.test/api/no-store-fixture'),
      createDependencies(store),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UPSTREAM_UNAVAILABLE', requestId: 'redirect-request-id' },
    });
  });
});
