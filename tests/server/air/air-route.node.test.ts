// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import * as airRouteModule from '../../../src/server/routes/air';

const airRouteApi = airRouteModule as Record<string, unknown>;
const measurementFixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../fixtures/airkorea/measurement-success.json'), 'utf8'),
) as unknown;
const stationFixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../fixtures/airkorea/station-directory-success.json'), 'utf8'),
) as unknown;
const NOW = Date.parse('2026-06-15T09:09:00+09:00');
const syntheticConfig = {
  measurementBaseUrl: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
  measurementKey: 'synthetic-quality-key',
  stationBaseUrl: 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc',
  stationKey: 'synthetic-station-key',
} as const;

describe('/api/air request contract', () => {
  it('defaults an absent region to seoul and keeps admission identity out of cache identity', async () => {
    const createAirRoute = airRouteApi.createAirRoute;
    const readAdmissionSubject = vi.fn(() => createAdmissionSubject('opaque-air-quality-fixture'));

    expect(createAirRoute).toBeTypeOf('function');
    if (typeof createAirRoute !== 'function') {
      return;
    }

    const route = createAirRoute({ readAdmissionSubject });
    const request = new Request('https://balance.test/api/air');

    await expect(Promise.resolve(route.parseRequest(request))).resolves.toEqual({
      admissionSubject: 'opaque-air-quality-fixture',
      input: { region: 'seoul' },
      publicCacheIdentity: { region: 'seoul' },
    });
    expect(readAdmissionSubject).toHaveBeenCalledOnce();
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);
  });

  it.each([
    ['seoul', 'seoul'],
    [' SEOUL ', 'seoul'],
    [' 서울 ', 'seoul'],
    ['busan', 'busan'],
    ['부산', 'busan'],
    ['incheon', 'incheon'],
    ['인천', 'incheon'],
    ['daegu', 'daegu'],
    ['대구', 'daegu'],
    ['gwangju', 'gwangju'],
    ['광주', 'gwangju'],
    ['daejeon', 'daejeon'],
    ['대전', 'daejeon'],
    ['jeju', 'jeju'],
    ['제주', 'jeju'],
  ] as const)('normalizes region alias %s to canonical identity %s', async (inputRegion, region) => {
    const createAirRoute = airRouteApi.createAirRoute;

    expect(createAirRoute).toBeTypeOf('function');
    if (typeof createAirRoute !== 'function') {
      return;
    }

    const route = createAirRoute({
      readAdmissionSubject: () => createAdmissionSubject('opaque-air-quality-fixture'),
    });
    const request = new Request(`https://balance.test/api/air?region=${encodeURIComponent(inputRegion)}`);

    await expect(Promise.resolve(route.parseRequest(request))).resolves.toMatchObject({
      input: { region },
      publicCacheIdentity: { region },
    });
  });

  it.each([
    '/api/air?region=seoul&region=seoul',
    '/api/air?region=seoul&region=busan',
    '/api/air?region=',
    '/api/air?region=unknown',
    '/api/air?region=toString',
    '/api/air?region=__proto__',
    '/api/air?region=seoul&debug=true',
    '/api/air?Region=seoul',
    '/api/air?unused=',
  ])('rejects repeated, empty, unknown, prototype or extra query input: %s', async (path) => {
    const createAirRoute = airRouteApi.createAirRoute;

    expect(createAirRoute).toBeTypeOf('function');
    if (typeof createAirRoute !== 'function') {
      return;
    }

    const route = createAirRoute({
      readAdmissionSubject: () => createAdmissionSubject('opaque-air-quality-fixture'),
    });

    await expect(
      Promise.resolve().then(() => route.parseRequest(new Request(`https://balance.test${path}`))),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('air-quality route loader', () => {
  it('loads and normalizes the two-service result with collection time separate from observation time', async () => {
    const createAirRoute = airRouteApi.createAirRoute;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const payload = url.pathname.endsWith('/getCtprvnRltmMesureDnsty') ? measurementFixture : stationFixture;
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    expect(createAirRoute).toBeTypeOf('function');
    if (typeof createAirRoute !== 'function') {
      return;
    }

    const route = createAirRoute({
      clock: () => NOW,
      config: {
        measurementBaseUrl: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
        measurementKey: 'synthetic-quality-key',
        stationBaseUrl: 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc',
        stationKey: 'synthetic-station-key',
      },
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-air-quality-fixture'),
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/air?region=seoul'));

    expect(route.load).toBeTypeOf('function');
    if (typeof route.load !== 'function') {
      return;
    }

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toMatchObject({
      kind: 'value',
      data: {
        observedAt: Date.parse('2026-06-15T09:00:00+09:00'),
        observedStationCount: 4,
        region: 'seoul',
        totalStationCount: 5,
      },
      fetchedAt: NOW,
      source: 'AirKorea',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails with MISSING_CREDENTIALS before starting either provider request', async () => {
    const createAirRoute = airRouteApi.createAirRoute;
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));

    expect(createAirRoute).toBeTypeOf('function');
    if (typeof createAirRoute !== 'function') {
      return;
    }

    const route = createAirRoute({
      clock: () => NOW,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-air-quality-fixture'),
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/air?region=seoul'));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a negative-cacheable empty outcome for a successful empty measurement page', async () => {
    const createAirRoute = airRouteApi.createAirRoute;
    const emptyMeasurement = structuredClone(measurementFixture) as {
      response: {
        body: {
          items: unknown[];
          totalCount: number;
        };
      };
    };
    emptyMeasurement.response.body.items = [];
    emptyMeasurement.response.body.totalCount = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const payload = url.pathname.endsWith('/getCtprvnRltmMesureDnsty') ? emptyMeasurement : stationFixture;
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    expect(createAirRoute).toBeTypeOf('function');
    if (typeof createAirRoute !== 'function') {
      return;
    }

    const route = createAirRoute({
      clock: () => NOW,
      config: syntheticConfig,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-air-quality-fixture'),
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/air?region=seoul'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toEqual({
      kind: 'empty',
      data: null,
      fetchedAt: NOW,
      source: 'AirKorea',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      createFetcher: (rawMarker: string) =>
        vi.fn(async (input: RequestInfo | URL) => {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          const measurement = structuredClone(measurementFixture) as {
            response: {
              header: { resultCode: string; resultMsg: string };
            };
          };
          measurement.response.header = {
            resultCode: '03',
            resultMsg: rawMarker,
          };
          const payload = url.pathname.endsWith('/getCtprvnRltmMesureDnsty') ? measurement : stationFixture;
          return new Response(JSON.stringify(payload), { status: 200 });
        }),
      label: 'logical failure',
      rawMarker: 'RAW_ROUTE_LOGICAL_MESSAGE_MUST_NOT_ESCAPE',
    },
    {
      createFetcher: (rawMarker: string) => vi.fn(async () => new Response(rawMarker, { status: 503 })),
      label: 'HTTP failure',
      rawMarker: 'RAW_ROUTE_HTTP_BODY_MUST_NOT_ESCAPE',
    },
    {
      createFetcher: (rawMarker: string) =>
        vi.fn(
          async () =>
            new Response(`{${rawMarker}`, {
              headers: { 'content-type': 'application/json' },
              status: 200,
            }),
        ),
      label: 'non-JSON success',
      rawMarker: 'RAW_ROUTE_NON_JSON_BODY_MUST_NOT_ESCAPE',
    },
    {
      createFetcher: (rawMarker: string) =>
        vi.fn(async (input: RequestInfo | URL) => {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          const measurement = structuredClone(measurementFixture) as {
            response: {
              body: { items: unknown };
            };
          };
          measurement.response.body.items = rawMarker;
          const payload = url.pathname.endsWith('/getCtprvnRltmMesureDnsty') ? measurement : stationFixture;
          return new Response(JSON.stringify(payload), { status: 200 });
        }),
      label: 'schema failure',
      rawMarker: 'RAW_ROUTE_SCHEMA_FIELD_MUST_NOT_ESCAPE',
    },
  ])('maps a provider $label to safe UPSTREAM_UNAVAILABLE', async ({ createFetcher, rawMarker }) => {
    const createAirRoute = airRouteApi.createAirRoute;

    expect(createAirRoute).toBeTypeOf('function');
    if (typeof createAirRoute !== 'function') {
      return;
    }

    const route = createAirRoute({
      clock: () => NOW,
      config: syntheticConfig,
      fetcher: createFetcher(rawMarker),
      readAdmissionSubject: () => createAdmissionSubject('opaque-air-quality-fixture'),
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/air?region=seoul'));
    let thrown: unknown;

    try {
      await route.load(parsed.input, new AbortController().signal);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain(rawMarker);
  });

  it('preserves the supplied abort reason instead of reclassifying it', async () => {
    const createAirRoute = airRouteApi.createAirRoute;

    expect(createAirRoute).toBeTypeOf('function');
    if (typeof createAirRoute !== 'function') {
      return;
    }

    const controller = new AbortController();
    const reason = new Error('synthetic caller deadline');
    controller.abort(reason);
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const route = createAirRoute({
      clock: () => NOW,
      config: syntheticConfig,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-air-quality-fixture'),
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/air?region=seoul'));

    await expect(route.load(parsed.input, controller.signal)).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('air-quality route schema and profile', () => {
  it('freezes the approved cache, budget and breaker profile on /api/air', () => {
    const createAirRoute = airRouteApi.createAirRoute;
    const profile = airRouteApi.AIR_ROUTE_PROFILE;

    expect(createAirRoute).toBeTypeOf('function');
    expect(profile).toBeDefined();
    if (typeof createAirRoute !== 'function' || profile === undefined) {
      return;
    }

    const route = createAirRoute({
      readAdmissionSubject: () => createAdmissionSubject('opaque-air-quality-fixture'),
    });

    expect(route.id).toBe('air');
    expect(route.path).toBe('/api/air');
    expect(route.dataSchema).toBeDefined();
    expect(profile).toEqual({
      admissionRate: {
        limit: 60,
        scope: 'route.air',
        windowMs: 60_000,
      },
      breaker: {
        cooldownMs: 30_000,
        failureThreshold: 3,
        failureWindowMs: 60_000,
        probeTimeoutMs: 5_000,
        scope: 'provider.airkorea',
      },
      cdnMaxAgeSeconds: 15 * 60,
      freshForMs: 30 * 60_000,
      lockPollMs: 50,
      lockSafetyMs: 1_000,
      lockWaitMs: 2_000,
      negativeForMs: 5 * 60_000,
      staleIfErrorForMs: 2 * 60 * 60_000,
      upstreamBudget: {
        limit: 350,
        scope: 'provider.airkorea',
        windowMs: 24 * 60 * 60_000,
      },
      upstreamTimeoutMs: 8_000,
    });
    expect(route.profile).toBe(profile);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen((profile as { admissionRate: unknown }).admissionRate)).toBe(true);
    expect(Object.isFrozen((profile as { breaker: unknown }).breaker)).toBe(true);
    expect(Object.isFrozen((profile as { upstreamBudget: unknown }).upstreamBudget)).toBe(true);
  });
});
