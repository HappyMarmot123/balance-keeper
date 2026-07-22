import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAdmissionSubject } from '../../../src/server/gateway';
import { createWeatherRoute, WEATHER_ROUTE_PROFILE } from '../../../src/server/routes/weather';

const fixturePath = resolve(import.meta.dirname, '../../fixtures/kma/ultra-short-nowcast-success.json');
const readFixture = (): unknown => JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;
const NOW = Date.parse('2026-07-22T14:25:00+09:00');

const createFixtureRoute = (serviceKey: string | null = 'fixture-service-key') => {
  const fetcher = vi.fn(
    async (): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(readFixture()), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
  );
  const readAdmissionSubject = vi.fn(() => createAdmissionSubject('opaque-weather-fixture'));
  const route = createWeatherRoute({
    clock: () => NOW,
    fetcher,
    readAdmissionSubject,
    ...(serviceKey === null ? {} : { serviceKey }),
  });

  return { fetcher, readAdmissionSubject, route };
};

const parseRequest = async (url: string) =>
  createFixtureRoute().route.parseRequest(new Request(`https://balance.test${url}`));

describe('/api/weather request contract', () => {
  it('defaults an absent region to seoul and keeps admission identity out of cache identity', async () => {
    const { readAdmissionSubject, route } = createFixtureRoute();
    const request = new Request('https://balance.test/api/weather');

    await expect(Promise.resolve(route.parseRequest(request))).resolves.toEqual({
      admissionSubject: 'opaque-weather-fixture',
      input: { region: 'seoul' },
      publicCacheIdentity: { region: 'seoul' },
    });
    expect(readAdmissionSubject).toHaveBeenCalledOnce();
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);
  });

  it.each(['seoul', 'busan', 'incheon', 'daegu', 'gwangju', 'daejeon', 'jeju'])(
    'accepts the approved region %s',
    async (region) => {
      await expect(parseRequest(`/api/weather?region=${region}`)).resolves.toMatchObject({
        input: { region },
        publicCacheIdentity: { region },
      });
    },
  );

  it('normalizes region whitespace and case before creating the cache identity', async () => {
    await expect(parseRequest('/api/weather?region=%20SEOUL%20')).resolves.toMatchObject({
      input: { region: 'seoul' },
      publicCacheIdentity: { region: 'seoul' },
    });
  });

  it.each([
    '/api/weather?region=seoul&region=seoul',
    '/api/weather?region=seoul&region=busan',
    '/api/weather?region=',
    '/api/weather?region=unknown',
    '/api/weather?region=toString',
    '/api/weather?region=__proto__',
    '/api/weather?region=seoul&debug=true',
    '/api/weather?Region=seoul',
    '/api/weather?region=seoul&unused=',
  ])('rejects repeated, empty, unknown, case-mismatched or extra query input: %s', async (path) => {
    await expect(parseRequest(path)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('weather route loader', () => {
  it('loads and normalizes a value outcome with collection time separate from observation time', async () => {
    const { route } = createFixtureRoute();
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather?region=seoul'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toEqual({
      kind: 'value',
      data: {
        region: 'seoul',
        observedAt: Date.parse('2026-07-22T14:00:00+09:00'),
        temperatureCelsius: 27.4,
        relativeHumidityPercent: 68,
        precipitationLastHourMm: 0,
        precipitationType: 'none',
        windSpeedMetersPerSecond: 2.5,
        windDirectionDegrees: 270,
      },
      fetchedAt: NOW,
      source: 'KMA',
    });
  });

  it('represents a successful provider result without supported categories as a negative-cacheable empty outcome', async () => {
    const fixture = readFixture() as {
      response: { body: { items: { item: unknown[] }; totalCount: number } };
    };
    fixture.response.body.items.item = [];
    fixture.response.body.totalCount = 0;
    const fetcher = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify(fixture), { headers: { 'content-type': 'application/json' } })),
    );
    const route = createWeatherRoute({
      clock: () => NOW,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-weather-fixture'),
      serviceKey: 'fixture-service-key',
    });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toEqual({
      kind: 'empty',
      data: null,
      fetchedAt: NOW,
      source: 'KMA',
    });
  });

  it('fails with MISSING_CREDENTIALS before attempting a provider call when the canonical key is absent', async () => {
    const { fetcher, route } = createFixtureRoute(null);
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather'));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a provider logical failure to UPSTREAM_UNAVAILABLE without exposing the raw message', async () => {
    const fixture = readFixture() as { response: { header: { resultCode: string; resultMsg: string } } };
    fixture.response.header = {
      resultCode: '03',
      resultMsg: 'RAW_PROVIDER_MESSAGE_MUST_NOT_ESCAPE',
    };
    const fetcher = vi.fn(async () => Promise.resolve(new Response(JSON.stringify(fixture))));
    const route = createWeatherRoute({
      clock: () => NOW,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-weather-fixture'),
      serviceKey: 'fixture-service-key',
    });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather'));
    let thrown: unknown;

    try {
      await route.load(parsed.input, new AbortController().signal);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(String(thrown)).not.toContain('RAW_PROVIDER_MESSAGE_MUST_NOT_ESCAPE');
  });

  it('preserves the supplied abort reason instead of reclassifying it', async () => {
    const controller = new AbortController();
    const reason = new Error('fixture request deadline');
    const fetcher = vi.fn(async (): Promise<Response> => {
      controller.abort(reason);
      throw new TypeError('provider fetch aborted');
    });
    const route = createWeatherRoute({
      clock: () => NOW,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-weather-fixture'),
      serviceKey: 'fixture-service-key',
    });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather'));

    await expect(route.load(parsed.input, controller.signal)).rejects.toBe(reason);
  });

  it.each([
    [
      'network failure',
      'RAW_NETWORK_DETAIL_MUST_NOT_ESCAPE',
      async () => {
        throw new TypeError('RAW_NETWORK_DETAIL_MUST_NOT_ESCAPE');
      },
    ],
    [
      'invalid JSON',
      'RAW_INVALID_JSON_MUST_NOT_ESCAPE',
      async () => new Response('{RAW_INVALID_JSON_MUST_NOT_ESCAPE', { status: 200 }),
    ],
    [
      'malformed raw schema',
      'RAW_SCHEMA_DETAIL_MUST_NOT_ESCAPE',
      async () => {
        const fixture = readFixture() as { response: { body: { items: unknown } } };
        fixture.response.body.items = 'RAW_SCHEMA_DETAIL_MUST_NOT_ESCAPE';
        return new Response(JSON.stringify(fixture), { status: 200 });
      },
    ],
    [
      'normalization range failure',
      'RAW_RANGE_DETAIL_MUST_NOT_ESCAPE',
      async () => {
        const fixture = readFixture() as {
          response: { body: { items: { item: Array<{ category: string; obsrValue: string }> } } };
        };
        fixture.response.body.items.item = fixture.response.body.items.item.map((item) =>
          item.category === 'REH' ? { ...item, obsrValue: '101' } : item,
        );
        return new Response(JSON.stringify(fixture), {
          headers: { 'x-fixture-detail': 'RAW_RANGE_DETAIL_MUST_NOT_ESCAPE' },
          status: 200,
        });
      },
    ],
  ] as const)('maps a provider %s to a safe UPSTREAM_UNAVAILABLE error', async (_case, rawMarker, fetcher) => {
    const route = createWeatherRoute({
      clock: () => NOW,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-weather-fixture'),
      serviceKey: 'fixture-service-key',
    });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather'));
    let thrown: unknown;

    try {
      await route.load(parsed.input, new AbortController().signal);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain(rawMarker);
  });

  it('uses the request-start clock for the slot and the validation-complete clock for fetchedAt', async () => {
    const startedAt = Date.parse('2026-07-22T14:25:00+09:00');
    const completedAt = Date.parse('2026-07-22T14:26:30+09:00');
    const clock = vi.fn().mockReturnValueOnce(startedAt).mockReturnValueOnce(completedAt);
    let requestedUrl: URL | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify(readFixture()), { status: 200 });
    });
    const route = createWeatherRoute({
      clock,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-weather-fixture'),
      serviceKey: 'fixture-service-key',
    });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather'));

    const outcome = await route.load(parsed.input, new AbortController().signal);

    expect(requestedUrl?.searchParams.get('base_date')).toBe('20260722');
    expect(requestedUrl?.searchParams.get('base_time')).toBe('1400');
    expect(outcome.fetchedAt).toBe(completedAt);
    expect(clock).toHaveBeenCalledTimes(2);
  });
});

describe('weather route schema and profile', () => {
  it('uses one strict nullable transport schema', () => {
    const { route } = createFixtureRoute();
    const valid = {
      region: 'seoul',
      observedAt: Date.parse('2026-07-22T14:00:00+09:00'),
      temperatureCelsius: null,
      relativeHumidityPercent: 68,
      precipitationLastHourMm: 0,
      precipitationType: 'none',
      windSpeedMetersPerSecond: 2.5,
      windDirectionDegrees: 270,
    };

    expect(route.dataSchema.safeParse(valid).success).toBe(true);
    expect(route.dataSchema.safeParse(null).success).toBe(true);
    expect(route.dataSchema.safeParse({ ...valid, debug: true }).success).toBe(false);
    expect(route.dataSchema.safeParse({ ...valid, temperatureCelsius: Number.NaN }).success).toBe(false);
    expect(route.dataSchema.safeParse({ ...valid, region: 'unknown' }).success).toBe(false);
  });

  it('freezes the approved cache, budget and breaker profile', () => {
    expect(WEATHER_ROUTE_PROFILE).toEqual({
      freshForMs: 10 * 60_000,
      staleIfErrorForMs: 60 * 60_000,
      negativeForMs: 60_000,
      upstreamTimeoutMs: 8_000,
      lockWaitMs: 2_000,
      lockPollMs: 50,
      lockSafetyMs: 1_000,
      admissionRate: { limit: 60, scope: 'route.weather', windowMs: 60_000 },
      upstreamBudget: {
        limit: 7_000,
        scope: 'provider.kma',
        windowMs: 24 * 60 * 60_000,
      },
      breaker: {
        scope: 'provider.kma',
        failureThreshold: 3,
        failureWindowMs: 60_000,
        cooldownMs: 30_000,
        probeTimeoutMs: 5_000,
      },
      cdnMaxAgeSeconds: 5 * 60,
    });
    expect(Object.isFrozen(WEATHER_ROUTE_PROFILE)).toBe(true);
    expect(Object.isFrozen(WEATHER_ROUTE_PROFILE.admissionRate)).toBe(true);
    expect(Object.isFrozen(WEATHER_ROUTE_PROFILE.upstreamBudget)).toBe(true);
    expect(Object.isFrozen(WEATHER_ROUTE_PROFILE.breaker)).toBe(true);
  });
});
