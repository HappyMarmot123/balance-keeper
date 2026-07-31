// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject, type OpaqueAdmissionSubject } from '../../../src/server/gateway';
import * as weatherRoutes from '../../../src/server/routes/weather';

type AlertRouteInput = Readonly<Record<string, never>>;
type AlertRoute = Readonly<{
  dataSchema: { safeParse: (value: unknown) => { success: boolean } };
  id: string;
  load: (input: AlertRouteInput, signal: AbortSignal) => Promise<unknown>;
  parseRequest: (request: Request) =>
    | Readonly<{
        admissionSubject: OpaqueAdmissionSubject;
        input: AlertRouteInput;
        publicCacheIdentity: Readonly<{ scope: string }>;
      }>
    | Promise<
        Readonly<{
          admissionSubject: OpaqueAdmissionSubject;
          input: AlertRouteInput;
          publicCacheIdentity: Readonly<{ scope: string }>;
        }>
      >;
  path: string;
}>;
type CreateAlertRoute = (options: {
  clock: () => number;
  fetcher: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}) => AlertRoute;

const createWeatherAlertsRoute = weatherRoutes.createWeatherAlertsRoute as CreateAlertRoute | undefined;
const WEATHER_ALERTS_ROUTE_PROFILE = weatherRoutes.WEATHER_ALERTS_ROUTE_PROFILE as
  | Readonly<Record<string, unknown>>
  | undefined;
const routeIt = typeof createWeatherAlertsRoute === 'function' ? it : it.skip;
const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../fixtures/kma/weather-alert-${name}.json`), 'utf8'),
  ) as unknown;
const STARTED_AT = Date.parse('2026-07-31T11:20:00+09:00');
const COMPLETED_AT = Date.parse('2026-07-31T11:20:01+09:00');

const createFixtureFetcher = (options: { empty?: boolean; invalidCodes?: boolean } = {}) =>
  vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
    if (url.pathname.endsWith('/getPwnStatus')) {
      return Response.json(fixture(options.empty === true ? 'status-empty' : 'status-active'));
    }
    if (url.pathname.endsWith('/getPwnCd')) {
      return options.invalidCodes === true
        ? Response.json({ providerDetail: 'MUST_NOT_ESCAPE' })
        : Response.json(fixture('codes-active'));
    }
    if (url.pathname.endsWith('/getWthrWrnMsg')) {
      return Response.json(fixture('message-success'));
    }
    return new Response(null, { status: 404 });
  });

const createFixtureRoute = (options: { empty?: boolean; fetcher?: typeof fetch; serviceKey?: string | null } = {}) => {
  if (createWeatherAlertsRoute === undefined) {
    throw new Error('Weather alerts route is not available');
  }
  const fetcher = options.fetcher ?? createFixtureFetcher({ empty: options.empty });
  const readAdmissionSubject = vi.fn(() => createAdmissionSubject('opaque-weather-alert-fixture'));
  const clock = vi.fn().mockReturnValueOnce(STARTED_AT).mockReturnValueOnce(COMPLETED_AT);
  const route = createWeatherAlertsRoute({
    clock,
    fetcher,
    readAdmissionSubject,
    ...(options.serviceKey === null ? {} : { serviceKey: options.serviceKey ?? 'fixture-service-key' }),
  });
  return { clock, fetcher, readAdmissionSubject, route };
};

describe('weather alerts route public boundary', () => {
  it('exports a separate route with a short-lived current-status profile', () => {
    expect(createWeatherAlertsRoute).toBeTypeOf('function');
    expect(WEATHER_ALERTS_ROUTE_PROFILE).toEqual({
      admissionRate: { limit: 60, scope: 'route.weather', windowMs: 60_000 },
      breaker: {
        cooldownMs: 30_000,
        failureThreshold: 3,
        failureWindowMs: 60_000,
        probeTimeoutMs: 5_000,
        scope: 'provider.kma.alerts',
      },
      cdnMaxAgeSeconds: 30,
      freshForMs: 60_000,
      lockPollMs: 50,
      lockSafetyMs: 1_000,
      lockWaitMs: 2_000,
      negativeForMs: 60_000,
      staleIfErrorForMs: 10 * 60_000,
      upstreamBudget: { limit: 7_000, scope: 'provider.kma', windowMs: 24 * 60 * 60_000 },
      upstreamBudgetCost: 3,
      upstreamTimeoutMs: 8_000,
    });
  });
});

describe('/api/weather/alerts request contract', () => {
  routeIt('owns an exact queryless route and stable public cache identity', async () => {
    const { readAdmissionSubject, route } = createFixtureRoute();
    const request = new Request('https://balance.test/api/weather/alerts');

    expect(route.id).toBe('weather-alerts');
    expect(route.path).toBe('/api/weather/alerts');
    await expect(Promise.resolve(route.parseRequest(request))).resolves.toEqual({
      admissionSubject: 'opaque-weather-alert-fixture',
      input: {},
      publicCacheIdentity: { scope: 'korea-weather-alerts' },
    });
    expect(readAdmissionSubject).toHaveBeenCalledWith(request);
  });

  routeIt.each(['/api/weather/alerts?region=seoul', '/api/weather/alerts?debug=true'])(
    'rejects every query parameter: %s',
    (path) => {
      const { route } = createFixtureRoute();
      expect(() => route.parseRequest(new Request(`https://balance.test${path}`))).toThrow(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    },
  );
});

describe('weather alerts route loader', () => {
  routeIt('loads a strict active snapshot and records completion time', async () => {
    const { clock, route } = createFixtureRoute();
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/alerts'));
    const outcome = (await route.load(parsed.input, new AbortController().signal)) as {
      data: { alerts: unknown[] };
      fetchedAt: number;
      kind: string;
      source: string;
    };

    expect(outcome).toMatchObject({
      fetchedAt: COMPLETED_AT,
      kind: 'value',
      source: 'KMA',
    });
    expect(outcome.data.alerts).toHaveLength(2);
    expect(clock).toHaveBeenCalledTimes(2);
  });

  routeIt('returns a negative-cacheable empty outcome only for a successful empty status', async () => {
    const { route } = createFixtureRoute({ empty: true });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/alerts'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toEqual({
      data: null,
      fetchedAt: COMPLETED_AT,
      kind: 'empty',
      source: 'KMA',
    });
  });

  routeIt('fails before fetch when the canonical credential is absent', async () => {
    const { fetcher, route } = createFixtureRoute({ serviceKey: null });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/alerts'));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  routeIt('maps raw provider failures to a safe upstream error', async () => {
    const { route } = createFixtureRoute({ fetcher: createFixtureFetcher({ invalidCodes: true }) });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/alerts'));
    let thrown: unknown;
    try {
      await route.load(parsed.input, new AbortController().signal);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain('MUST_NOT_ESCAPE');
  });

  routeIt('preserves the supplied abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('fixture weather-alert deadline');
    const fetcher = vi.fn(async (): Promise<Response> => {
      controller.abort(reason);
      throw new TypeError('provider fetch aborted');
    });
    const { route } = createFixtureRoute({ fetcher });
    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather/alerts'));

    await expect(route.load(parsed.input, controller.signal)).rejects.toBe(reason);
  });
});

describe('weather alerts route schema and profile', () => {
  routeIt('uses the strict nullable weather-alert schema', () => {
    const { route } = createFixtureRoute();
    expect(route.dataSchema.safeParse(null).success).toBe(true);
    expect(
      route.dataSchema.safeParse({
        alerts: [],
        bulletin: { availability: 'unavailable' },
        providerSecret: 'must-not-pass',
        statusEffectiveAt: STARTED_AT,
        statusIssuedAt: STARTED_AT,
      }).success,
    ).toBe(false);
  });

  routeIt('freezes every profile boundary', () => {
    expect(Object.isFrozen(WEATHER_ALERTS_ROUTE_PROFILE)).toBe(true);
    expect(Object.isFrozen(WEATHER_ALERTS_ROUTE_PROFILE?.admissionRate)).toBe(true);
    expect(Object.isFrozen(WEATHER_ALERTS_ROUTE_PROFILE?.upstreamBudget)).toBe(true);
    expect(Object.isFrozen(WEATHER_ALERTS_ROUTE_PROFILE?.breaker)).toBe(true);
  });
});
