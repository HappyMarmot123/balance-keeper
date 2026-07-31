// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject, type OpaqueAdmissionSubject } from '../../../src/server/gateway';
import * as weatherRoutes from '../../../src/server/routes/weather';

type ForecastRouteInput = Readonly<{ region: string }>;
type ForecastRoute = Readonly<{
  dataSchema: { safeParse: (value: unknown) => { success: boolean } };
  id: string;
  load: (input: ForecastRouteInput, signal: AbortSignal) => Promise<unknown>;
  parseRequest: (request: Request) =>
    | Readonly<{
        admissionSubject: OpaqueAdmissionSubject;
        input: ForecastRouteInput;
        publicCacheIdentity: ForecastRouteInput;
      }>
    | Promise<
        Readonly<{
          admissionSubject: OpaqueAdmissionSubject;
          input: ForecastRouteInput;
          publicCacheIdentity: ForecastRouteInput;
        }>
      >;
  path: string;
}>;
type CreateForecastRoute = (options: {
  clock: () => number;
  fetcher: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}) => ForecastRoute;
type MutableForecastFixture = {
  response: {
    body: {
      items: { item: unknown[] };
      numOfRows: number;
      pageNo: number;
      totalCount: number;
    };
    header: { resultCode: string; resultMsg: string };
  };
};

const createWeatherForecastRoute = weatherRoutes.createWeatherForecastRoute as CreateForecastRoute | undefined;
const WEATHER_FORECAST_ROUTE_PROFILE = weatherRoutes.WEATHER_FORECAST_ROUTE_PROFILE as
  | Readonly<Record<string, unknown>>
  | undefined;
const routeIt = typeof createWeatherForecastRoute === 'function' ? it : it.skip;
const fixturePath = resolve(import.meta.dirname, '../../fixtures/kma/short-term-forecast-success.json');
const readFixture = (): MutableForecastFixture =>
  JSON.parse(readFileSync(fixturePath, 'utf8')) as MutableForecastFixture;
const STARTED_AT = Date.parse('2026-07-31T08:25:00+09:00');
const COMPLETED_AT = Date.parse('2026-07-31T08:25:01+09:00');

const createFixtureRoute = (options: { fetcher?: typeof fetch; serviceKey?: string | null } = {}) => {
  if (createWeatherForecastRoute === undefined) {
    throw new Error('Forecast route is not available');
  }
  const fetcher =
    options.fetcher ??
    vi.fn(async () =>
      Promise.resolve(
        Response.json(readFixture(), {
          status: 200,
        }),
      ),
    );
  const readAdmissionSubject = vi.fn(() => createAdmissionSubject('opaque-weather-forecast-fixture'));
  const clock = vi.fn().mockReturnValueOnce(STARTED_AT).mockReturnValueOnce(COMPLETED_AT);
  const route = createWeatherForecastRoute({
    clock,
    fetcher,
    readAdmissionSubject,
    ...(options.serviceKey === null ? {} : { serviceKey: options.serviceKey ?? 'fixture-service-key' }),
  });

  return { clock, fetcher, readAdmissionSubject, route };
};

describe('weather forecast route public boundary', () => {
  it('exports a separate route and publication-aware cache profile', () => {
    expect(createWeatherForecastRoute).toBeTypeOf('function');
    expect(WEATHER_FORECAST_ROUTE_PROFILE).toEqual({
      admissionRate: { limit: 60, scope: 'route.weather', windowMs: 60_000 },
      breaker: {
        cooldownMs: 30_000,
        failureThreshold: 3,
        failureWindowMs: 60_000,
        probeTimeoutMs: 5_000,
        scope: 'provider.kma.forecast',
      },
      cdnMaxAgeSeconds: 15 * 60,
      freshForMs: 30 * 60_000,
      lockPollMs: 50,
      lockSafetyMs: 1_000,
      lockWaitMs: 2_000,
      negativeForMs: 5 * 60_000,
      staleIfErrorForMs: 6 * 60 * 60_000,
      upstreamBudget: { limit: 7_000, scope: 'provider.kma', windowMs: 24 * 60 * 60_000 },
      upstreamTimeoutMs: 8_000,
    });
  });
});

describe('/api/weather/forecast request contract', () => {
  routeIt('owns an exact route id/path and defaults an absent region to Seoul', async () => {
    const { readAdmissionSubject, route } = createFixtureRoute();
    const request = new Request('https://balance.test/api/weather/forecast');

    expect(route.id).toBe('weather-forecast');
    expect(route.path).toBe('/api/weather/forecast');
    await expect(Promise.resolve(route.parseRequest(request))).resolves.toEqual({
      admissionSubject: 'opaque-weather-forecast-fixture',
      input: { region: 'seoul' },
      publicCacheIdentity: { region: 'seoul' },
    });
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);
  });

  routeIt.each([
    '/api/weather/forecast?region=seoul&region=seoul',
    '/api/weather/forecast?region=',
    '/api/weather/forecast?region=unknown',
    '/api/weather/forecast?region=__proto__',
    '/api/weather/forecast?region=seoul&debug=true',
  ])('rejects non-canonical query input: %s', (path) => {
    const { route } = createFixtureRoute();

    expect(() => route.parseRequest(new Request(`https://balance.test${path}`))).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });
});

describe('weather forecast route loader', () => {
  routeIt('loads one strict 24-hour value and separates collection time from issued time', async () => {
    const { clock, route } = createFixtureRoute();
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/forecast?region=seoul'));

    const outcome = (await route.load(parsed.input, new AbortController().signal)) as {
      data: { issuedAt: number; periods: unknown[]; region: string };
      fetchedAt: number;
      kind: string;
      source: string;
    };

    expect(outcome).toMatchObject({
      data: {
        issuedAt: Date.parse('2026-07-31T08:00:00+09:00'),
        region: 'seoul',
      },
      fetchedAt: COMPLETED_AT,
      kind: 'value',
      source: 'KMA',
    });
    expect(outcome.data.periods).toHaveLength(24);
    expect(clock).toHaveBeenCalledTimes(2);
  });

  routeIt('returns a negative-cacheable empty outcome for a successful empty provider result', async () => {
    const fixture = readFixture();
    fixture.response.body.items.item = [];
    fixture.response.body.totalCount = 0;
    const fetcher = vi.fn(async () => Response.json(fixture));
    const { route } = createFixtureRoute({ fetcher });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/forecast'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toEqual({
      data: null,
      fetchedAt: COMPLETED_AT,
      kind: 'empty',
      source: 'KMA',
    });
  });

  routeIt('fails before fetch when the canonical credential is absent', async () => {
    const { fetcher, route } = createFixtureRoute({ serviceKey: null });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/forecast'));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  routeIt('maps provider details to a safe upstream error', async () => {
    const fixture = readFixture();
    fixture.response.header = {
      resultCode: '03',
      resultMsg: 'RAW_FORECAST_PROVIDER_DETAIL_MUST_NOT_ESCAPE',
    };
    const fetcher = vi.fn(async () => Response.json(fixture));
    const { route } = createFixtureRoute({ fetcher });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/forecast'));
    let thrown: unknown;

    try {
      await route.load(parsed.input, new AbortController().signal);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain('RAW_FORECAST_PROVIDER_DETAIL_MUST_NOT_ESCAPE');
  });

  routeIt('preserves the supplied abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('fixture forecast deadline');
    const fetcher = vi.fn(async (): Promise<Response> => {
      controller.abort(reason);
      throw new TypeError('provider fetch aborted');
    });
    const { route } = createFixtureRoute({ fetcher });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/forecast'));

    await expect(route.load(parsed.input, controller.signal)).rejects.toBe(reason);
  });
});

describe('weather forecast route schema and profile', () => {
  routeIt('uses the strict nullable forecast schema', () => {
    const { route } = createFixtureRoute();
    const invalid = {
      issuedAt: STARTED_AT,
      periods: [],
      providerSecret: 'must-not-pass',
      region: 'seoul',
    };

    expect(route.dataSchema.safeParse(null).success).toBe(true);
    expect(route.dataSchema.safeParse(invalid).success).toBe(false);
  });

  routeIt('freezes every profile boundary', () => {
    expect(Object.isFrozen(WEATHER_FORECAST_ROUTE_PROFILE)).toBe(true);
    expect(Object.isFrozen(WEATHER_FORECAST_ROUTE_PROFILE?.admissionRate)).toBe(true);
    expect(Object.isFrozen(WEATHER_FORECAST_ROUTE_PROFILE?.upstreamBudget)).toBe(true);
    expect(Object.isFrozen(WEATHER_FORECAST_ROUTE_PROFILE?.breaker)).toBe(true);
  });
});
