// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import * as routeModule from '../../../src/server/routes/road-traffic';

const routeApi = routeModule as Readonly<Record<string, unknown>>;
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-detectors-success.json', import.meta.url), 'utf8'),
) as unknown;
const now = Date.parse('2026-08-07T12:02:00+09:00');
const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

type DetectorRoute = Readonly<{
  load(input: Record<string, never>, signal: AbortSignal): Promise<unknown>;
  parseRequest(request: Request): unknown;
}>;
type CreateDetectorRoute = (
  options: Readonly<{
    clock?: () => number;
    fetcher?: typeof fetch;
    readAdmissionSubject: (request: Request) => ReturnType<typeof createAdmissionSubject>;
    serviceKey?: string;
  }>,
) => DetectorRoute;

describe('/api/road-traffic/detectors route', () => {
  it('accepts only one query-free nationwide cache identity', async () => {
    const createRoute = routeApi.createRoadTrafficDetectorsRoute as CreateDetectorRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const route = createRoute({ readAdmissionSubject: () => createAdmissionSubject('opaque-detectors') });
    expect(route.parseRequest(new Request('https://balance.test/api/road-traffic/detectors'))).toEqual({
      admissionSubject: 'opaque-detectors',
      input: {},
      publicCacheIdentity: { scope: 'korea-road-traffic-detectors' },
    });
    for (const query of ['?vdsId=1', '?bbox=126,37,127,38', '?page=1']) {
      expect(() =>
        route.parseRequest(new Request(`https://balance.test/api/road-traffic/detectors${query}`)),
      ).toThrow();
    }
  });

  it('uses an isolated five-minute cache, one-hour stale window and daily provider budget', () => {
    expect(routeApi.ROAD_TRAFFIC_DETECTOR_ROUTE_PROFILE).toMatchObject({
      admissionRate: { limit: 30, scope: 'route.road-traffic-detectors', windowMs: 60_000 },
      cdnMaxAgeSeconds: 60,
      freshForMs: 5 * 60_000,
      negativeForMs: 60_000,
      staleIfErrorForMs: 60 * 60_000,
      upstreamBudget: { limit: 300, scope: 'provider.its-road-traffic-detectors', windowMs: 24 * 60 * 60_000 },
      upstreamBudgetCost: 1,
      upstreamTimeoutMs: 15_000,
    });
  });

  it('loads value and empty snapshots, blocks missing credentials and sanitizes provider failures', async () => {
    const createRoute = routeApi.createRoadTrafficDetectorsRoute as CreateDetectorRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const create = (fetcher: typeof fetch, serviceKey?: string) =>
      createRoute({
        clock: () => now,
        fetcher,
        readAdmissionSubject: () => createAdmissionSubject('opaque-detectors'),
        ...(serviceKey === undefined ? {} : { serviceKey }),
      });

    await expect(
      create(async () => jsonResponse(fixture), 'synthetic-secret').load({}, new AbortController().signal),
    ).resolves.toMatchObject({ data: { detectors: expect.any(Array), generatedAt: now }, kind: 'value' });
    const empty = structuredClone(fixture) as { body: { items: unknown[]; totalCount: string } };
    empty.body.items = [];
    empty.body.totalCount = '0';
    await expect(
      create(async () => jsonResponse(empty), 'synthetic-secret').load({}, new AbortController().signal),
    ).resolves.toMatchObject({ data: { detectors: [] }, kind: 'empty' });

    const noKeyFetcher = vi.fn(async () => jsonResponse(fixture));
    await expect(create(noKeyFetcher).load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(noKeyFetcher).not.toHaveBeenCalled();
    await expect(
      create(async () => jsonResponse({ raw: 'unsafe' }, { status: 502 }), 'synthetic-secret').load(
        {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
