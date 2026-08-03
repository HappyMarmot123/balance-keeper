// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';

const incidentFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-events-incidents-success.json', import.meta.url), 'utf8'),
) as unknown;
const disasterFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-events-disasters-success.json', import.meta.url), 'utf8'),
) as unknown;
const now = Date.parse('2026-08-03T15:20:00+09:00');
const routeModulePath = '../../../src/server/routes/road-events/index.ts';

type RoadEventsRoute = Readonly<{
  load(input: Record<string, never>, signal: AbortSignal): Promise<unknown>;
  parseRequest(request: Request): unknown;
}>;

type CreateRoadEventsRoute = (
  options: Readonly<{
    clock?: () => number;
    fetcher?: typeof fetch;
    readAdmissionSubject: (request: Request) => ReturnType<typeof createAdmissionSubject>;
    serviceKey?: string;
  }>,
) => RoadEventsRoute;

let routeApi: Readonly<Record<string, unknown>> = {};

beforeAll(async () => {
  if (existsSync(resolve(process.cwd(), 'src/server/routes/road-events/index.ts'))) {
    routeApi = (await import(/* @vite-ignore */ routeModulePath)) as Readonly<Record<string, unknown>>;
  }
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('road events route boundary', () => {
  it('publishes only the two approved event routes', () => {
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/road-events/roadEventRoutes.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/road-events/index.ts'))).toBe(true);
    expect(routeApi.createRoadEventIncidentsRoute).toBeTypeOf('function');
    expect(routeApi.createRoadEventDisastersRoute).toBeTypeOf('function');
    expect(routeApi.createDangerousCarRoute).toBeUndefined();
  });

  it.each([
    ['createRoadEventIncidentsRoute', '/api/road-events/incidents', 'korea-road-events-incidents'],
    ['createRoadEventDisastersRoute', '/api/road-events/disasters', 'korea-road-events-disasters'],
  ] as const)('accepts only the fixed query-free identity for %s', (factoryName, path, scope) => {
    const createRoute = routeApi[factoryName] as CreateRoadEventsRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const readAdmissionSubject = vi.fn(() => createAdmissionSubject(`opaque-${scope}`));
    const route = createRoute({ readAdmissionSubject });
    const request = new Request(`https://balance.test${path}`);

    expect(route.parseRequest(request)).toEqual({
      admissionSubject: `opaque-${scope}`,
      input: {},
      publicCacheIdentity: { scope },
    });
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);
    for (const query of ['?bbox=124,32,132,40', '?eventType=all', '?startDate=20260801']) {
      expect(() => route.parseRequest(new Request(`https://balance.test${path}${query}`))).toThrowError(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    }
  });
});

describe('road events route profiles and loaders', () => {
  it('keeps incidents on an isolated two-minute freshness and bounded daily budget', async () => {
    expect(routeApi.ROAD_EVENT_INCIDENTS_ROUTE_PROFILE).toMatchObject({
      admissionRate: { limit: 60, scope: 'route.road-events-incidents', windowMs: 60_000 },
      cdnMaxAgeSeconds: 30,
      freshForMs: 2 * 60_000,
      negativeForMs: 30_000,
      staleIfErrorForMs: 15 * 60_000,
      upstreamBudget: { limit: 720, scope: 'provider.its-road-events-incidents', windowMs: 24 * 60 * 60_000 },
      upstreamBudgetCost: 1,
      upstreamTimeoutMs: 8_000,
    });
    const createRoute = routeApi.createRoadEventIncidentsRoute as CreateRoadEventsRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const fetcher = vi.fn(async () => jsonResponse(incidentFixture));
    const route = createRoute({
      clock: () => now,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-incidents'),
      serviceKey: 'synthetic-its-secret',
    });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      data: { channel: 'incidents', events: [expect.any(Object), expect.any(Object)], generatedAt: now },
      fetchedAt: now,
      kind: 'value',
      source: expect.stringContaining('국가교통정보센터'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps disasters on an isolated five-minute freshness and bounded daily budget', async () => {
    expect(routeApi.ROAD_EVENT_DISASTERS_ROUTE_PROFILE).toMatchObject({
      admissionRate: { limit: 60, scope: 'route.road-events-disasters', windowMs: 60_000 },
      cdnMaxAgeSeconds: 60,
      freshForMs: 5 * 60_000,
      negativeForMs: 60_000,
      staleIfErrorForMs: 60 * 60_000,
      upstreamBudget: { limit: 288, scope: 'provider.its-road-events-disasters', windowMs: 24 * 60 * 60_000 },
      upstreamBudgetCost: 1,
      upstreamTimeoutMs: 8_000,
    });
    const createRoute = routeApi.createRoadEventDisastersRoute as CreateRoadEventsRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const fetcher = vi.fn(async () => jsonResponse(disasterFixture));
    const route = createRoute({
      clock: () => now,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-disasters'),
      serviceKey: 'synthetic-its-secret',
    });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      data: {
        channel: 'disasters',
        events: [expect.any(Object), expect.any(Object), expect.any(Object)],
        generatedAt: now,
      },
      fetchedAt: now,
      kind: 'value',
      source: expect.stringContaining('국가교통정보센터'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['createRoadEventIncidentsRoute', 'createRoadEventDisastersRoute'] as const)(
    'fails before provider access when %s has no ITS credential',
    async (factoryName) => {
      const createRoute = routeApi[factoryName] as CreateRoadEventsRoute | undefined;
      expect(createRoute).toBeTypeOf('function');
      if (createRoute === undefined) return;
      const fetcher = vi.fn(async () => jsonResponse(incidentFixture));
      const route = createRoute({
        fetcher,
        readAdmissionSubject: () => createAdmissionSubject('opaque-missing-road-events'),
      });

      await expect(route.load({}, new AbortController().signal)).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
