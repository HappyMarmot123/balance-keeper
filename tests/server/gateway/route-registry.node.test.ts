// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createAdmissionSubject,
  createRouteProfile,
  createRouteRegistry,
  type GatewayRoute,
  type GatewayRouteProfile,
} from '../../../src/server/gateway';

const profile = createRouteProfile({
  freshForMs: 1_000,
  staleIfErrorForMs: 5_000,
  negativeForMs: false,
  upstreamTimeoutMs: 750,
  lockWaitMs: 500,
  lockPollMs: 25,
  lockSafetyMs: 100,
  admissionRate: { limit: 30, windowMs: 60_000, scope: 'route.fixture' },
  upstreamBudget: { limit: 10, windowMs: 60_000, scope: 'provider.fixture' },
  breaker: {
    scope: 'provider.fixture',
    failureThreshold: 3,
    failureWindowMs: 30_000,
    cooldownMs: 15_000,
    probeTimeoutMs: 2_000,
  },
  cdnMaxAgeSeconds: 60,
});

const dataSchema = z.object({ count: z.number() }).strict();

function createFixtureRoute(
  id: string,
  path: `/api/${string}`,
  routeProfile: GatewayRouteProfile = profile,
): GatewayRoute {
  return {
    id,
    path,
    dataSchema,
    profile: routeProfile,
    parseRequest: () => ({
      input: undefined,
      publicCacheIdentity: {},
      admissionSubject: createAdmissionSubject('opaque-fixture-subject'),
    }),
    load: async () => ({ kind: 'value', data: { count: 1 }, source: 'fixture', fetchedAt: 1 }),
  };
}

describe('createRouteRegistry', () => {
  it('resolves only the exact registered pathname', () => {
    const weather = createFixtureRoute('weather', '/api/weather');
    const cctvList = createFixtureRoute('cctv-list', '/api/cctv/list');
    const registry = createRouteRegistry([weather, cctvList]);

    expect(registry.getByPath('/api/weather')).toBe(weather);
    expect(registry.getByPath('/api/cctv/list')).toBe(cctvList);
    expect(registry.getByPath('/api/weather?region=seoul')).toBeUndefined();
    expect(registry.getByPath('/api/weather/')).toBeUndefined();
    expect(registry.getByPath('/api/Weather')).toBeUndefined();
  });

  it('rejects duplicate route identifiers before serving requests', () => {
    expect(() =>
      createRouteRegistry([
        createFixtureRoute('weather', '/api/weather'),
        createFixtureRoute('weather', '/api/weather-hourly'),
      ]),
    ).toThrow(/duplicate route id/i);
  });

  it('rejects duplicate route paths before serving requests', () => {
    expect(() =>
      createRouteRegistry([
        createFixtureRoute('weather-current', '/api/weather'),
        createFixtureRoute('weather-hourly', '/api/weather'),
      ]),
    ).toThrow(/duplicate route path/i);
  });

  it.each([
    '/weather',
    '/api',
    '/api/',
    '/api/weather/',
    '/api//weather',
    '/api/../admin',
    '/api/%2e%2e/admin',
    '/api/weather?secret=value',
    '/api/weather#fragment',
    '/api\\weather',
    'https://balance.test/api/weather',
  ])('rejects unsafe or non-canonical route path %s', (path) => {
    expect(() => createRouteRegistry([createFixtureRoute('unsafe-route', path as `/api/${string}`)])).toThrow(
      /safe canonical \/api pathname/i,
    );
  });

  it.each(['', 'Weather', 'weather route', 'weather?region'])('rejects unsafe route id %s', (id) => {
    expect(() => createRouteRegistry([createFixtureRoute(id, '/api/weather')])).toThrow(/safe route id/i);
  });

  it('accepts a safe route id at the 64-character cache-key boundary', () => {
    const route = createFixtureRoute('a'.repeat(64), '/api/weather');

    expect(createRouteRegistry([route]).getByPath('/api/weather')).toBe(route);
  });

  it('rejects a route id beyond the 64-character cache-key boundary', () => {
    expect(() => createRouteRegistry([createFixtureRoute('a'.repeat(65), '/api/weather')])).toThrow(/safe route id/i);
  });

  it('revalidates each route profile when the registry is created', () => {
    const route = createFixtureRoute('weather', '/api/weather');
    const invalidRoute = {
      ...route,
      profile: { ...route.profile, freshForMs: 0 },
    } as GatewayRoute;

    expect(() => createRouteRegistry([invalidRoute])).toThrow();
  });

  it('freezes a registered route and a profile that bypassed the profile creator', () => {
    const mutableProfile = {
      ...profile,
      admissionRate: { ...profile.admissionRate },
      upstreamBudget: { ...profile.upstreamBudget },
      breaker: { ...profile.breaker },
    } as GatewayRouteProfile;
    const route = createFixtureRoute('weather', '/api/weather', mutableProfile);
    const registry = createRouteRegistry([route]);

    expect(Object.isFrozen(route)).toBe(true);
    expect(Object.isFrozen(route.profile)).toBe(true);
    expect(Object.isFrozen(route.profile.admissionRate)).toBe(true);
    expect(Object.isFrozen(route.profile.upstreamBudget)).toBe(true);
    expect(Object.isFrozen(route.profile.breaker)).toBe(true);
    expect(() => {
      (route.profile.breaker as { failureThreshold: number }).failureThreshold += 1;
    }).toThrow(TypeError);
    expect(registry.getByPath('/api/weather')?.profile.breaker.failureThreshold).toBe(profile.breaker.failureThreshold);
  });

  it.each([
    ['limit', { ...profile.admissionRate, limit: profile.admissionRate.limit + 1 }],
    ['window', { ...profile.admissionRate, windowMs: profile.admissionRate.windowMs + 1 }],
  ])('rejects a shared admission scope with a conflicting %s', (_field, admissionRate) => {
    const conflictingProfile = createRouteProfile({ ...profile, admissionRate });

    expect(() =>
      createRouteRegistry([
        createFixtureRoute('weather', '/api/weather'),
        createFixtureRoute('air', '/api/air', conflictingProfile),
      ]),
    ).toThrow(/conflicting admission rate policy/i);
  });

  it.each([
    ['limit', { ...profile.upstreamBudget, limit: profile.upstreamBudget.limit + 1 }],
    ['window', { ...profile.upstreamBudget, windowMs: profile.upstreamBudget.windowMs + 1 }],
  ])('rejects a shared upstream-budget scope with a conflicting %s', (_field, upstreamBudget) => {
    const conflictingProfile = createRouteProfile({ ...profile, upstreamBudget });

    expect(() =>
      createRouteRegistry([
        createFixtureRoute('weather', '/api/weather'),
        createFixtureRoute('air', '/api/air', conflictingProfile),
      ]),
    ).toThrow(/conflicting upstream budget policy/i);
  });

  it.each([
    ['failure threshold', { ...profile.breaker, failureThreshold: profile.breaker.failureThreshold + 1 }],
    ['failure window', { ...profile.breaker, failureWindowMs: profile.breaker.failureWindowMs + 1 }],
    ['cooldown', { ...profile.breaker, cooldownMs: profile.breaker.cooldownMs + 1 }],
    ['probe timeout', { ...profile.breaker, probeTimeoutMs: profile.breaker.probeTimeoutMs + 1 }],
  ])('rejects a shared breaker scope with a conflicting %s', (_field, breaker) => {
    const conflictingProfile = createRouteProfile({ ...profile, breaker });

    expect(() =>
      createRouteRegistry([
        createFixtureRoute('weather', '/api/weather'),
        createFixtureRoute('air', '/api/air', conflictingProfile),
      ]),
    ).toThrow(/conflicting breaker policy/i);
  });

  it('rejects a shared breaker scope with a different derived half-open lease', () => {
    const conflictingProfile = createRouteProfile({
      ...profile,
      lockSafetyMs: profile.lockSafetyMs + 1,
    });

    expect(() =>
      createRouteRegistry([
        createFixtureRoute('weather', '/api/weather'),
        createFixtureRoute('air', '/api/air', conflictingProfile),
      ]),
    ).toThrow(/conflicting breaker policy/i);
  });

  it('rejects a shared breaker scope with a different closed completion bound', () => {
    const shortProbeProfile = createRouteProfile({
      ...profile,
      breaker: { ...profile.breaker, probeTimeoutMs: 100 },
    });
    const conflictingProfile = createRouteProfile({
      ...shortProbeProfile,
      upstreamTimeoutMs: shortProbeProfile.upstreamTimeoutMs + 1,
    });

    expect(() =>
      createRouteRegistry([
        createFixtureRoute('weather', '/api/weather', shortProbeProfile),
        createFixtureRoute('air', '/api/air', conflictingProfile),
      ]),
    ).toThrow(/conflicting breaker policy/i);
  });

  it('rejects an overflowed half-open lease when a profile bypasses its creator', () => {
    const overflowProfile: GatewayRouteProfile = {
      ...profile,
      lockSafetyMs: Number.MAX_SAFE_INTEGER,
      breaker: { ...profile.breaker, probeTimeoutMs: 1 },
    };

    expect(() => createRouteRegistry([createFixtureRoute('weather', '/api/weather', overflowProfile)])).toThrow(
      /fleet lease|breaker state retention/i,
    );
  });

  it('allows independent coordination scopes to use different policies', () => {
    const independentProfile = createRouteProfile({
      ...profile,
      lockSafetyMs: profile.lockSafetyMs + 1,
      admissionRate: { ...profile.admissionRate, limit: 31, scope: 'route.air' },
      upstreamBudget: { ...profile.upstreamBudget, limit: 11, scope: 'provider.air-korea' },
      breaker: { ...profile.breaker, failureThreshold: 4, scope: 'route.air' },
    });

    expect(() =>
      createRouteRegistry([
        createFixtureRoute('weather', '/api/weather'),
        createFixtureRoute('air', '/api/air', independentProfile),
      ]),
    ).not.toThrow();
  });
});
