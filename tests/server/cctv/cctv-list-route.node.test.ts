// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import * as cctvRouteModule from '../../../src/server/routes/cctv';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-success.json', import.meta.url), 'utf8'),
) as {
  expressway: { live: unknown; still: unknown };
  nationalRoad: { live: unknown; still: unknown };
};
const emptyFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-empty.json', import.meta.url), 'utf8'),
) as unknown;

const routeApi = cctvRouteModule as Readonly<Record<string, unknown>>;
const now = Date.parse('2026-07-30T10:00:00+09:00');

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const createFixtureFetcher = () =>
  vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const roadFixture = url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
    return jsonResponse(url.searchParams.get('cctvType') === '3' ? roadFixture.still : roadFixture.live);
  });

describe('/api/cctv/list request contract', () => {
  it('canonicalizes one bounded Korea bbox into the public cache identity', async () => {
    expect(routeApi.createCctvListRoute).toBeTypeOf('function');
    if (typeof routeApi.createCctvListRoute !== 'function') {
      return;
    }
    const readAdmissionSubject = vi.fn(() => createAdmissionSubject('opaque-cctv-subject'));
    const route = routeApi.createCctvListRoute({ readAdmissionSubject });
    const request = new Request('https://balance.test/api/cctv/list?bbox=126.5000,37,127.5,38.0000');

    await expect(Promise.resolve(route.parseRequest(request))).resolves.toEqual({
      admissionSubject: 'opaque-cctv-subject',
      input: {
        maximumLatitude: 38,
        maximumLongitude: 127.5,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
      },
      publicCacheIdentity: {
        maximumLatitude: 38,
        maximumLongitude: 127.5,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
      },
    });
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);
  });

  it.each([
    '/api/cctv/list',
    '/api/cctv/list?bbox=',
    '/api/cctv/list?bbox=126.5,37,127.5',
    '/api/cctv/list?bbox=126.5,37,127.5,38,39',
    '/api/cctv/list?bbox=126.5,37,127.5,38&bbox=126.5,37,127.5,38',
    '/api/cctv/list?bbox=126.5,37,127.5,38&debug=true',
    '/api/cctv/list?bbox=126.50001,37,127.5,38',
    '/api/cctv/list?bbox=1.265e2,37,127.5,38',
    '/api/cctv/list?bbox=127.5,37,126.5,38',
    '/api/cctv/list?bbox=126.5,38,127.5,37',
    '/api/cctv/list?bbox=126,37,127.0001,38',
    '/api/cctv/list?bbox=123.9,37,124.5,38',
    '/api/cctv/list?bbox=126.5,32.9,127.5,33.5',
  ])('rejects malformed, repeated, excessive or out-of-Korea bbox input: %s', async (path) => {
    expect(routeApi.createCctvListRoute).toBeTypeOf('function');
    if (typeof routeApi.createCctvListRoute !== 'function') {
      return;
    }
    const route = routeApi.createCctvListRoute({
      readAdmissionSubject: () => createAdmissionSubject('opaque-cctv-subject'),
    });
    await expect(
      Promise.resolve().then(() => route.parseRequest(new Request(`https://balance.test${path}`))),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('CCTV list route loader and profile', () => {
  it('loads the atomic provider snapshot through the approved cache and quota profile', async () => {
    expect(routeApi.createCctvListRoute).toBeTypeOf('function');
    expect(routeApi.CCTV_LIST_ROUTE_PROFILE).toMatchObject({
      admissionRate: { limit: 30, scope: 'route.cctv-list', windowMs: 60_000 },
      cdnMaxAgeSeconds: 300,
      freshForMs: 10 * 60_000,
      negativeForMs: 5 * 60_000,
      staleIfErrorForMs: 60 * 60_000,
      upstreamBudget: {
        limit: 200,
        scope: 'provider.its-cctv',
        windowMs: 24 * 60 * 60_000,
      },
      upstreamTimeoutMs: 8_000,
    });
    if (typeof routeApi.createCctvListRoute !== 'function') {
      return;
    }
    const fetcher = createFixtureFetcher();
    const route = routeApi.createCctvListRoute({
      clock: () => now,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-cctv-subject'),
      serviceKey: 'synthetic-its-key',
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toMatchObject({
      data: {
        bounds: parsed.input,
        cameras: [{ roadType: 'expressway' }, { roadType: 'national-road' }],
      },
      fetchedAt: now,
      kind: 'value',
      source: 'ITS 국가교통정보센터',
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('fails before provider access when ITS_API_KEY is missing', async () => {
    expect(routeApi.createCctvListRoute).toBeTypeOf('function');
    if (typeof routeApi.createCctvListRoute !== 'function') {
      return;
    }
    const fetcher = createFixtureFetcher();
    const route = routeApi.createCctvListRoute({
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-cctv-subject'),
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38'));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies four valid empty provider responses as one empty route outcome', async () => {
    expect(routeApi.createCctvListRoute).toBeTypeOf('function');
    if (typeof routeApi.createCctvListRoute !== 'function') {
      return;
    }
    const fetcher = vi.fn(async () => jsonResponse(emptyFixture));
    const route = routeApi.createCctvListRoute({
      clock: () => now,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-cctv-subject'),
      serviceKey: 'synthetic-its-key',
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toMatchObject({
      data: { cameras: [] },
      fetchedAt: now,
      kind: 'empty',
      source: 'ITS 국가교통정보센터',
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
