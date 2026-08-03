// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import * as routeModule from '../../../src/server/routes/road-traffic';

const routeApi = routeModule as Readonly<Record<string, unknown>>;
const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-forecast-success.json', import.meta.url), 'utf8'),
) as { body: { items: unknown[]; totalCount: string } };
const now = Date.parse('2026-08-03T15:20:00+09:00');
const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

type ForecastRoute = Readonly<{
  load(input: Record<string, never>, signal: AbortSignal): Promise<unknown>;
  parseRequest(request: Request): unknown;
}>;
type CreateForecastRoute = (
  options: Readonly<{
    clock?: () => number;
    fetcher?: typeof fetch;
    readAdmissionSubject: (request: Request) => ReturnType<typeof createAdmissionSubject>;
    serviceKey?: string;
  }>,
) => ForecastRoute;

describe('/api/road-traffic/forecast route boundary', () => {
  it('publishes the approved forecast-only route module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/road-traffic/roadTrafficForecastRoute.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/road-traffic/index.ts'))).toBe(true);
  });

  it('accepts only the fixed query-free product identity', async () => {
    const createRoute = routeApi.createRoadTrafficForecastRoute as CreateForecastRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) {
      return;
    }
    const readAdmissionSubject = vi.fn(() => createAdmissionSubject('opaque-road-traffic-forecast'));
    const route = createRoute({ readAdmissionSubject });
    const request = new Request('https://balance.test/api/road-traffic/forecast');

    await expect(Promise.resolve(route.parseRequest(request))).resolves.toEqual({
      admissionSubject: 'opaque-road-traffic-forecast',
      input: {},
      publicCacheIdentity: { scope: 'korea-road-traffic-forecast-section-1' },
    });
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);

    for (const path of [
      '/api/road-traffic/forecast?sectionId=1',
      '/api/road-traffic/forecast?routeNo=1',
      '/api/road-traffic/forecast?fCastHour=15',
    ]) {
      await expect(
        Promise.resolve().then(() => route.parseRequest(new Request(`https://balance.test${path}`))),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
  });
});

describe('road traffic forecast route loader and profile', () => {
  it('loads one forecast through an isolated thirty-minute cache and daily budget', async () => {
    expect(routeApi.ROAD_TRAFFIC_FORECAST_ROUTE_PROFILE).toMatchObject({
      admissionRate: { limit: 60, scope: 'route.road-traffic-forecast', windowMs: 60_000 },
      cdnMaxAgeSeconds: 60,
      freshForMs: 30 * 60_000,
      negativeForMs: 5 * 60_000,
      staleIfErrorForMs: 6 * 60 * 60_000,
      upstreamBudget: {
        limit: 48,
        scope: 'provider.its-road-traffic-forecast',
        windowMs: 24 * 60 * 60_000,
      },
      upstreamBudgetCost: 1,
      upstreamTimeoutMs: 8_000,
    });
    const createRoute = routeApi.createRoadTrafficForecastRoute as CreateForecastRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) {
      return;
    }
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const route = createRoute({
      clock: () => now,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-road-traffic-forecast'),
      serviceKey: 'synthetic-its-secret',
    });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      data: {
        forecastAt: Date.parse('2026-08-03T15:00:00+09:00'),
        sectionId: '1',
        segments: [
          { linkId: 'LINK-001', speedUnit: 'provider-unspecified' },
          { linkId: 'LINK-002', speedUnit: 'provider-unspecified' },
        ],
      },
      fetchedAt: now,
      kind: 'value',
      source: expect.stringContaining('국가교통정보센터'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fails before provider access when ITS_API_KEY is missing', async () => {
    const createRoute = routeApi.createRoadTrafficForecastRoute as CreateForecastRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) {
      return;
    }
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const route = createRoute({
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-road-traffic-forecast'),
    });

    await expect(route.load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies valid empty separately from sanitized provider failure', async () => {
    const createRoute = routeApi.createRoadTrafficForecastRoute as CreateForecastRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) {
      return;
    }
    const create = (fetcher: typeof fetch) =>
      createRoute({
        clock: () => now,
        fetcher,
        readAdmissionSubject: () => createAdmissionSubject('opaque-road-traffic-forecast'),
        serviceKey: 'synthetic-its-secret',
      });
    const emptyFixture = structuredClone(successFixture);
    emptyFixture.body.items = [];
    emptyFixture.body.totalCount = '0';

    await expect(
      create(vi.fn(async () => jsonResponse(emptyFixture))).load({}, new AbortController().signal),
    ).resolves.toMatchObject({ data: { segments: [] }, kind: 'empty' });
    await expect(
      create(vi.fn(async () => jsonResponse({ raw: 'unsafe provider detail' }, { status: 502 }))).load(
        {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
