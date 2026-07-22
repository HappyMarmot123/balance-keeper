import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createAdmissionSubject, createRouteProfile, type GatewayRoute } from '../../../src/server/gateway';

const profile = createRouteProfile({
  freshForMs: 1_000,
  staleIfErrorForMs: 5_000,
  negativeForMs: false,
  upstreamTimeoutMs: 750,
  lockWaitMs: 500,
  lockPollMs: 25,
  lockSafetyMs: 100,
  admissionRate: { limit: 30, windowMs: 60_000, scope: 'route.runtime-fixture' },
  upstreamBudget: { limit: 10, windowMs: 60_000, scope: 'provider.runtime-fixture' },
  breaker: {
    scope: 'provider.runtime-fixture',
    failureThreshold: 3,
    failureWindowMs: 30_000,
    cooldownMs: 15_000,
    probeTimeoutMs: 2_000,
  },
  cdnMaxAgeSeconds: 60,
});

const createFixtureRoute = (load: GatewayRoute['load']): GatewayRoute => ({
  id: 'runtime-fixture',
  path: '/api/runtime-fixture',
  dataSchema: z.object({ value: z.number() }).strict(),
  profile,
  parseRequest: () => ({
    input: undefined,
    publicCacheIdentity: {},
    admissionSubject: createAdmissionSubject('opaque-runtime-fixture'),
  }),
  load,
});

describe('createGatewayRuntime', () => {
  it('serves strict 404 responses before unavailable fleet state is consulted', async () => {
    const runtimeModule = (await import('../../../src/server/runtime')) as Record<string, unknown>;

    expect(runtimeModule.createGatewayRuntime).toEqual(expect.any(Function));

    const runtime = (
      runtimeModule.createGatewayRuntime as (options: unknown) => {
        handle(request: Request): Promise<Response>;
      }
    )({ environment: {}, createRequestId: () => 'request-runtime-1' });
    const response = await runtime.handle(new Request('https://balance.test/api/missing'));

    expect(response.status).toBe(404);
    expect(response.headers.get('x-request-id')).toBe('request-runtime-1');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', requestId: 'request-runtime-1' },
    });
  });

  it('fails a registered route closed when production fleet state is unavailable', async () => {
    const { createGatewayRuntime } = await import('../../../src/server/runtime');
    const load = vi.fn<GatewayRoute['load']>();
    const runtime = createGatewayRuntime({
      environment: {},
      routes: [createFixtureRoute(load)],
      createRequestId: () => 'request-runtime-2',
    });

    const response = await runtime.handle(new Request('https://balance.test/api/runtime-fixture'));

    expect(response.status).toBe(503);
    expect(load).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', requestId: 'request-runtime-2' },
    });
  });

  it('wires an explicitly injected fleet-state adapter through the real handler', async () => {
    let now = 1_000;
    const route = createFixtureRoute(async () => ({
      kind: 'value',
      data: { value: 7 },
      source: 'runtime-fixture',
      fetchedAt: now,
    }));
    const { createGatewayRuntime } = await import('../../../src/server/runtime');
    const runtime = createGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-runtime-1',
      createRequestId: () => 'request-runtime-3',
      environment: {},
      fleetStateStore: new MemoryFleetStateStore(() => now),
      routes: [route],
    });

    expect(
      (
        runtime as unknown as {
          getCdnMaxAgeSeconds(pathname: string): number | undefined;
        }
      ).getCdnMaxAgeSeconds('/api/runtime-fixture'),
    ).toBe(60);
    expect(
      (
        runtime as unknown as {
          getCdnMaxAgeSeconds(pathname: string): number | undefined;
        }
      ).getCdnMaxAgeSeconds('/api/missing'),
    ).toBeUndefined();

    const response = await runtime.handle(new Request('https://balance.test/api/runtime-fixture'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { value: 7 },
      meta: { cache: 'MISS', requestId: 'request-runtime-3' },
    });

    now += 1;
  });

  it('rejects partial production credentials during assembly', async () => {
    const { createGatewayRuntime } = await import('../../../src/server/runtime');

    expect(() =>
      createGatewayRuntime({
        environment: { UPSTASH_REDIS_REST_URL: 'https://example.upstash.io' },
      }),
    ).toThrow(/configured together/);
  });
});
