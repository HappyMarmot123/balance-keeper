// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import * as maritimeTrafficRouteModule from '../../../src/server/routes/maritime-traffic';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/komsa/maritime-traffic-success.json', import.meta.url), 'utf8'),
) as {
  response: {
    body: {
      items: { item: unknown[] };
      totalCount: number;
    };
  };
};
const emptyFixture = structuredClone(successFixture);
emptyFixture.response.body.items.item = [];
emptyFixture.response.body.totalCount = 0;

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

const now = Date.parse('2026-07-31T12:35:00+09:00');

describe('/api/maritime-traffic route boundary', () => {
  it('publishes the approved route module before contract behavior is implemented', () => {
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/maritime-traffic/maritimeTrafficRoute.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/maritime-traffic/index.ts'))).toBe(true);
  });

  it('accepts only the fixed query-free GET identity', async () => {
    expect(maritimeTrafficRouteModule.createMaritimeTrafficRoute).toBeTypeOf('function');
    const readAdmissionSubject = vi.fn(() => createAdmissionSubject('opaque-maritime-traffic-subject'));
    const route = maritimeTrafficRouteModule.createMaritimeTrafficRoute({ readAdmissionSubject });
    const request = new Request('https://balance.test/api/maritime-traffic');

    await expect(Promise.resolve(route.parseRequest(request))).resolves.toEqual({
      admissionSubject: 'opaque-maritime-traffic-subject',
      input: {},
      publicCacheIdentity: { scope: 'korea-maritime-traffic-latest' },
    });
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);

    for (const path of [
      '/api/maritime-traffic?debug=1',
      '/api/maritime-traffic?pageNo=1',
      '/api/maritime-traffic?pageNo=1&pageNo=1',
    ]) {
      await expect(
        Promise.resolve().then(() => route.parseRequest(new Request(`https://balance.test${path}`))),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
  });
});

describe('maritime traffic route loader and profile', () => {
  it('loads the current aggregate through the approved cache and quota profile', async () => {
    expect(maritimeTrafficRouteModule.MARITIME_TRAFFIC_ROUTE_PROFILE).toMatchObject({
      admissionRate: { limit: 60, scope: 'route.maritime-traffic', windowMs: 60_000 },
      cdnMaxAgeSeconds: 60,
      freshForMs: 5 * 60_000,
      negativeForMs: 60_000,
      staleIfErrorForMs: 60 * 60_000,
      upstreamBudget: {
        limit: 400,
        scope: 'provider.komsa-mtis',
        windowMs: 24 * 60 * 60_000,
      },
      upstreamBudgetCost: 1,
      upstreamTimeoutMs: 8_000,
    });
    expect(maritimeTrafficRouteModule.createMaritimeTrafficRoute).toBeTypeOf('function');
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const route = maritimeTrafficRouteModule.createMaritimeTrafficRoute({
      clock: () => now,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-maritime-traffic-subject'),
      serviceKey: 'synthetic-data-go-key',
    });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      data: {
        cells: [
          { densityPercent: 43.5, gridId: 'G3SYNTHETIC_A1', vesselCount: 12 },
          { densityPercent: 18.25, gridId: 'G3SYNTHETIC_B2', vesselCount: 7 },
        ],
        generatedAt: Date.parse('2026-07-31T12:30:00+09:00'),
      },
      fetchedAt: now,
      kind: 'value',
      source: expect.stringContaining('한국해양교통안전공단'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fails before provider access when the canonical credential is missing', async () => {
    expect(maritimeTrafficRouteModule.createMaritimeTrafficRoute).toBeTypeOf('function');
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const route = maritimeTrafficRouteModule.createMaritimeTrafficRoute({
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-maritime-traffic-subject'),
    });

    await expect(route.load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies a valid aggregate empty separately from provider failures', async () => {
    expect(maritimeTrafficRouteModule.createMaritimeTrafficRoute).toBeTypeOf('function');
    const createRoute = (fetcher: typeof fetch) =>
      maritimeTrafficRouteModule.createMaritimeTrafficRoute({
        clock: () => now,
        fetcher,
        readAdmissionSubject: () => createAdmissionSubject('opaque-maritime-traffic-subject'),
        serviceKey: 'synthetic-data-go-key',
      });

    const emptyRoute = createRoute(vi.fn(async () => jsonResponse(emptyFixture)));
    await expect(emptyRoute.load({}, new AbortController().signal)).resolves.toMatchObject({
      data: { cells: [] },
      kind: 'empty',
    });

    const failedRoute = createRoute(vi.fn(async () => jsonResponse({ raw: 'provider detail' }, { status: 502 })));
    await expect(failedRoute.load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});
