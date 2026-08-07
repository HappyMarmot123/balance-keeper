// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import * as routeModule from '../../../src/server/routes/road-traffic';

const routeApi = routeModule as Readonly<Record<string, unknown>>;
const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-current-success.json', import.meta.url), 'utf8'),
) as { body: { items: unknown[]; totalCount: number | string } };
const bounds = {
  maximumLatitude: 37.6,
  maximumLongitude: 127.05,
  minimumLatitude: 37.5,
  minimumLongitude: 126.95,
} as const;
const now = Date.parse('2026-08-03T15:21:00+09:00');
const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

type CurrentRoute = Readonly<{
  load(input: typeof bounds, signal: AbortSignal): Promise<unknown>;
  parseRequest(request: Request): unknown;
}>;
type CreateCurrentRoute = (
  options: Readonly<{
    clock?: () => number;
    fetcher?: typeof fetch;
    readAdmissionSubject: (request: Request) => ReturnType<typeof createAdmissionSubject>;
    serviceKey?: string;
  }>,
) => CurrentRoute;

describe('/api/road-traffic/current route boundary', () => {
  it('publishes the bounded current route and request parser', () => {
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/road-traffic/roadTrafficCurrentRoute.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/road-traffic/roadTrafficCurrentRequest.ts'))).toBe(
      true,
    );
  });

  it('accepts one canonical bbox as both loader input and public cache identity', () => {
    const createRoute = routeApi.createRoadTrafficCurrentRoute as CreateCurrentRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const readAdmissionSubject = vi.fn(() => createAdmissionSubject('opaque-road-traffic-current'));
    const route = createRoute({ readAdmissionSubject });
    const request = new Request('https://balance.test/api/road-traffic/current?bbox=126.95,37.5,127.05,37.6');

    expect(route.parseRequest(request)).toEqual({
      admissionSubject: 'opaque-road-traffic-current',
      input: bounds,
      publicCacheIdentity: bounds,
    });
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);
  });

  it.each([
    '/api/road-traffic/current',
    '/api/road-traffic/current?bbox=',
    '/api/road-traffic/current?bbox=126.95,37.5,127.05',
    '/api/road-traffic/current?bbox=126.95,37.5,127.05,37.6&bbox=126.95,37.5,127.05,37.6',
    '/api/road-traffic/current?bbox=126.95,37.5,127.05,37.6&debug=1',
    '/api/road-traffic/current?bbox=126.95000,37.5,127.05,37.6',
    '/api/road-traffic/current?bbox=1.2695e2,37.5,127.05,37.6',
    '/api/road-traffic/current?bbox=126.9,37.5,127.05,37.6',
    '/api/road-traffic/current?bbox=127.05,37.5,126.95,37.6',
  ])('rejects noncanonical or unsafe query %s', (path) => {
    const createRoute = routeApi.createRoadTrafficCurrentRoute as CreateCurrentRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const route = createRoute({ readAdmissionSubject: () => createAdmissionSubject('opaque-road-traffic-current') });

    expect(() => route.parseRequest(new Request(`https://balance.test${path}`))).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });
});

describe('road traffic current route loader and profile', () => {
  it('loads through an isolated five-minute cache and bounded daily budget', async () => {
    expect(routeApi.ROAD_TRAFFIC_CURRENT_ROUTE_PROFILE).toMatchObject({
      admissionRate: { limit: 30, scope: 'route.road-traffic-current', windowMs: 60_000 },
      cdnMaxAgeSeconds: 60,
      freshForMs: 5 * 60_000,
      negativeForMs: 60_000,
      staleIfErrorForMs: 60 * 60_000,
      upstreamBudget: {
        limit: 500,
        scope: 'provider.its-road-traffic-current',
        windowMs: 24 * 60 * 60_000,
      },
      upstreamBudgetCost: 1,
      upstreamTimeoutMs: 8_000,
    });
    const createRoute = routeApi.createRoadTrafficCurrentRoute as CreateCurrentRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const route = createRoute({
      clock: () => now,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-road-traffic-current'),
      serviceKey: 'synthetic-its-secret',
    });

    await expect(route.load(bounds, new AbortController().signal)).resolves.toMatchObject({
      data: { bounds, segments: [{ linkId: 'LINK-001' }, { linkId: 'LINK-002' }] },
      fetchedAt: now,
      kind: 'value',
      source: expect.stringContaining('국가교통정보센터'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fails before provider access without ITS_API_KEY and sanitizes provider failures', async () => {
    const createRoute = routeApi.createRoadTrafficCurrentRoute as CreateCurrentRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const missing = createRoute({
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-road-traffic-current'),
    });
    await expect(missing.load(bounds, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();

    const failed = createRoute({
      fetcher: vi.fn(async () => jsonResponse({ raw: 'unsafe' }, { status: 502 })),
      readAdmissionSubject: () => createAdmissionSubject('opaque-road-traffic-current'),
      serviceKey: 'synthetic-its-secret',
    });
    await expect(failed.load(bounds, new AbortController().signal)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('classifies an observed empty bbox independently', async () => {
    const createRoute = routeApi.createRoadTrafficCurrentRoute as CreateCurrentRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const empty = structuredClone(successFixture);
    empty.body.items = [];
    empty.body.totalCount = 0;
    const route = createRoute({
      clock: () => now,
      fetcher: async () => jsonResponse(empty),
      readAdmissionSubject: () => createAdmissionSubject('opaque-road-traffic-current'),
      serviceKey: 'synthetic-its-secret',
    });

    await expect(route.load(bounds, new AbortController().signal)).resolves.toMatchObject({
      data: { bounds, segments: [] },
      kind: 'empty',
    });
  });
});
