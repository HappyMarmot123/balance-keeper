// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assertRouteProfile,
  createAdmissionSubject,
  createRouteProfile,
  createRouteRegistry,
  type GatewayRoute,
  rethrowAsUpstreamUnavailable,
} from '../../../src/server/gateway';
import { AppError } from '../../../src/shared/contracts';

const validProfile = {
  freshForMs: 1_000,
  staleIfErrorForMs: 5_000,
  negativeForMs: 250,
  upstreamTimeoutMs: 750,
  lockWaitMs: 500,
  lockPollMs: 25,
  lockSafetyMs: 100,
  admissionRate: { limit: 30, windowMs: 60_000, scope: 'route.weather' },
  upstreamBudget: { limit: 10, windowMs: 60_000, scope: 'provider.kma' },
  breaker: {
    scope: 'provider.kma',
    failureThreshold: 3,
    failureWindowMs: 30_000,
    cooldownMs: 15_000,
    probeTimeoutMs: 2_000,
  },
  cdnMaxAgeSeconds: 60,
} as const;

describe('gateway route public contract', () => {
  it('exports the route, profile, registry, and admission-subject entry points', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/gateway/index.ts'), 'utf8');
    const requiredExports = ['createAdmissionSubject', 'createRouteProfile', 'createRouteRegistry'];

    expect(requiredExports.filter((exportName) => !source.includes(exportName))).toEqual([]);
  });

  it('accepts a route profile only when every policy value is explicit', () => {
    expect(createRouteProfile(validProfile)).toEqual(validProfile);
  });

  it('deep-freezes a validated route profile so coordination policy cannot drift after startup', () => {
    const frozen = createRouteProfile(validProfile);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.admissionRate)).toBe(true);
    expect(Object.isFrozen(frozen.upstreamBudget)).toBe(true);
    expect(Object.isFrozen(frozen.breaker)).toBe(true);
    expect(() => {
      (frozen.upstreamBudget as { limit: number }).limit += 1;
    }).toThrow(TypeError);
  });

  it('accepts false as the only way to disable negative caching', () => {
    const profile = createRouteProfile({ ...validProfile, negativeForMs: false });

    expect(profile.negativeForMs).toBe(false);
    expect(() => assertRouteProfile(profile)).not.toThrow();
  });

  it('accepts either a route or provider low-cardinality breaker scope', () => {
    const routeScoped = createRouteProfile({
      ...validProfile,
      breaker: { ...validProfile.breaker, scope: 'route.weather' },
    });

    expect(routeScoped.breaker.scope).toBe('route.weather');
    expect(createRouteProfile(validProfile).breaker.scope).toBe('provider.kma');
  });

  it.each([
    ['freshForMs', { ...validProfile, freshForMs: 0 }],
    ['staleIfErrorForMs', { ...validProfile, staleIfErrorForMs: 0 }],
    ['negativeForMs', { ...validProfile, negativeForMs: 0 }],
    ['upstreamTimeoutMs', { ...validProfile, upstreamTimeoutMs: 0 }],
    ['lockWaitMs', { ...validProfile, lockWaitMs: 0 }],
    ['lockPollMs', { ...validProfile, lockPollMs: 0 }],
    ['lockSafetyMs', { ...validProfile, lockSafetyMs: 0 }],
    ['admissionRate.limit', { ...validProfile, admissionRate: { ...validProfile.admissionRate, limit: 0 } }],
    ['admissionRate.windowMs', { ...validProfile, admissionRate: { ...validProfile.admissionRate, windowMs: 0 } }],
    ['upstreamBudget.limit', { ...validProfile, upstreamBudget: { ...validProfile.upstreamBudget, limit: 0 } }],
    ['upstreamBudget.windowMs', { ...validProfile, upstreamBudget: { ...validProfile.upstreamBudget, windowMs: 0 } }],
    ['breaker.failureThreshold', { ...validProfile, breaker: { ...validProfile.breaker, failureThreshold: 0 } }],
    ['breaker.failureWindowMs', { ...validProfile, breaker: { ...validProfile.breaker, failureWindowMs: 0 } }],
    ['breaker.cooldownMs', { ...validProfile, breaker: { ...validProfile.breaker, cooldownMs: 0 } }],
    ['breaker.probeTimeoutMs', { ...validProfile, breaker: { ...validProfile.breaker, probeTimeoutMs: 0 } }],
    ['cdnMaxAgeSeconds', { ...validProfile, cdnMaxAgeSeconds: 0 }],
  ])('rejects a non-positive %s', (_field, input) => {
    expect(() => createRouteProfile(input)).toThrow();
  });

  it.each([
    ['fraction', { ...validProfile, freshForMs: 1.5 }],
    ['unsafe integer', { ...validProfile, freshForMs: Number.MAX_SAFE_INTEGER + 1 }],
    ['infinity', { ...validProfile, freshForMs: Number.POSITIVE_INFINITY }],
  ])('rejects a numeric policy expressed as a %s', (_case, input) => {
    expect(() => createRouteProfile(input)).toThrow();
  });

  it('uses the shorter effective probe timeout when the configured probe timeout is larger', () => {
    const boundaryProfile = createRouteProfile({
      ...validProfile,
      lockSafetyMs: 1,
      breaker: { ...validProfile.breaker, probeTimeoutMs: Number.MAX_SAFE_INTEGER - 1 },
    });

    expect(boundaryProfile.breaker.probeTimeoutMs).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  it('accepts a breaker retention sum at the maximum safe integer boundary', () => {
    const boundaryProfile = createRouteProfile({
      ...validProfile,
      lockSafetyMs: 1,
      breaker: { ...validProfile.breaker, failureWindowMs: Number.MAX_SAFE_INTEGER - 1 },
    });

    expect(boundaryProfile.breaker.failureWindowMs + boundaryProfile.lockSafetyMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects a breaker retention duration that cannot keep a positive safety margin', () => {
    expect(() =>
      createRouteProfile({
        ...validProfile,
        breaker: { ...validProfile.breaker, failureWindowMs: Number.MAX_SAFE_INTEGER },
      }),
    ).toThrow(/breaker state retention/i);
  });

  it.each([
    [
      'admission identity',
      { ...validProfile, admissionRate: { ...validProfile.admissionRate, scope: 'route/weather?ip=127.0.0.1' } },
    ],
    [
      'upstream raw URL',
      { ...validProfile, upstreamBudget: { ...validProfile.upstreamBudget, scope: 'https://provider.example' } },
    ],
    [
      'wrong admission prefix',
      { ...validProfile, admissionRate: { ...validProfile.admissionRate, scope: 'provider.kma' } },
    ],
    [
      'wrong upstream prefix',
      { ...validProfile, upstreamBudget: { ...validProfile.upstreamBudget, scope: 'route.weather' } },
    ],
    ['breaker raw URL', { ...validProfile, breaker: { ...validProfile.breaker, scope: 'https://provider.example' } }],
    [
      'breaker arbitrary prefix',
      { ...validProfile, breaker: { ...validProfile.breaker, scope: 'tenant.customer-123' } },
    ],
  ])('rejects a high-cardinality or unsafe %s scope', (_case, input) => {
    expect(() => createRouteProfile(input)).toThrow();
  });

  it('rejects missing and extension policy fields instead of applying defaults', () => {
    const { lockSafetyMs: _missing, ...missingField } = validProfile;
    const extensionField = { ...validProfile, retryCount: 5 };

    expect(() => createRouteProfile(missingField as typeof validProfile)).toThrow();
    expect(() => createRouteProfile(extensionField)).toThrow();
  });

  it('keeps the admission subject separate from validated public cache identity', async () => {
    const dataSchema = z.object({ count: z.number().int().nonnegative() }).strict();
    const signal = new AbortController().signal;
    const route = {
      id: 'weather',
      path: '/api/weather',
      dataSchema,
      profile: createRouteProfile(validProfile),
      parseRequest: (_request: Request) => ({
        input: { region: 'seoul' },
        publicCacheIdentity: { region: 'seoul' },
        admissionSubject: createAdmissionSubject('opaque-subject-01'),
      }),
      load: async (input, receivedSignal) => {
        expect(input).toEqual({ region: 'seoul' });
        expect(receivedSignal).toBe(signal);

        return { kind: 'value', data: { count: 1 }, source: 'fixture-kma', fetchedAt: 1_721_520_000_000 };
      },
    } satisfies GatewayRoute<{ region: string }, { region: string }, typeof dataSchema>;

    const parsed = await route.parseRequest(new Request('https://balance.test/api/weather?region=seoul'));
    const outcome = await route.load(parsed.input, signal);
    const registry = createRouteRegistry([route]);

    expect(parsed).toEqual({
      input: { region: 'seoul' },
      publicCacheIdentity: { region: 'seoul' },
      admissionSubject: 'opaque-subject-01',
    });
    expect(outcome).toEqual({
      kind: 'value',
      data: { count: 1 },
      source: 'fixture-kma',
      fetchedAt: 1_721_520_000_000,
    });
    expect(registry.getByPath('/api/weather')).toBe(route);
  });

  it.each(['', '   '])('rejects an empty opaque admission subject %#', (value) => {
    expect(() => createAdmissionSubject(value)).toThrow();
  });

  it('maps a caught provider-boundary failure to UPSTREAM_UNAVAILABLE without exposing the cause', () => {
    const cause = new TypeError('socket details must remain internal');

    try {
      rethrowAsUpstreamUnavailable(cause, new AbortController().signal);
      throw new Error('Expected the helper to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', cause });
    }
  });

  it('preserves an existing classified AppError and an upstream abort reason', () => {
    const classified = new AppError('MISSING_CREDENTIALS');
    expect(() => rethrowAsUpstreamUnavailable(classified, new AbortController().signal)).toThrow(classified);

    const controller = new AbortController();
    const abortReason = new Error('upstream deadline');
    controller.abort(abortReason);
    expect(() => rethrowAsUpstreamUnavailable(new TypeError('fetch aborted'), controller.signal)).toThrow(abortReason);
  });
});
