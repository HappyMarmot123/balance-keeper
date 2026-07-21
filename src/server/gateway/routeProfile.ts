import { z } from 'zod';
import type { BreakerPolicy } from '../cache';

const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const createScopeSchema = (prefix: 'route' | 'provider') =>
  z
    .string()
    .max(96)
    .regex(new RegExp(`^${prefix}\\.[a-z0-9]+(?:[.-][a-z0-9]+)*$`));

const createFixedWindowRateSchema = (prefix: 'route' | 'provider') =>
  z
    .object({
      limit: positiveSafeIntegerSchema,
      windowMs: positiveSafeIntegerSchema,
      scope: createScopeSchema(prefix),
    })
    .strict();

const breakerProfileSchema = z
  .object({
    scope: z.union([createScopeSchema('route'), createScopeSchema('provider')]),
    failureThreshold: positiveSafeIntegerSchema,
    failureWindowMs: positiveSafeIntegerSchema,
    cooldownMs: positiveSafeIntegerSchema,
    probeTimeoutMs: positiveSafeIntegerSchema,
  })
  .strict();

const gatewayRouteProfileSchema = z
  .object({
    freshForMs: positiveSafeIntegerSchema,
    staleIfErrorForMs: positiveSafeIntegerSchema,
    negativeForMs: z.union([positiveSafeIntegerSchema, z.literal(false)]),
    upstreamTimeoutMs: positiveSafeIntegerSchema,
    lockWaitMs: positiveSafeIntegerSchema,
    lockPollMs: positiveSafeIntegerSchema,
    lockSafetyMs: positiveSafeIntegerSchema,
    admissionRate: createFixedWindowRateSchema('route'),
    upstreamBudget: createFixedWindowRateSchema('provider'),
    breaker: breakerProfileSchema,
    cdnMaxAgeSeconds: positiveSafeIntegerSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    const halfOpenLeaseMs = Math.min(profile.upstreamTimeoutMs, profile.breaker.probeTimeoutMs) + profile.lockSafetyMs;
    const closedCompletionBoundMs = profile.upstreamTimeoutMs + profile.lockSafetyMs;

    if (!Number.isSafeInteger(halfOpenLeaseMs)) {
      context.addIssue({
        code: 'custom',
        message: 'half-open lease must be a positive safe integer',
        path: ['breaker', 'probeTimeoutMs'],
      });
    }

    if (!Number.isSafeInteger(closedCompletionBoundMs)) {
      context.addIssue({
        code: 'custom',
        message: 'fleet lease must be a positive safe integer',
        path: ['upstreamTimeoutMs'],
      });
    }

    const stateRetentionMs =
      Math.max(profile.breaker.failureWindowMs, profile.breaker.cooldownMs, halfOpenLeaseMs, closedCompletionBoundMs) +
      profile.lockSafetyMs;

    if (!Number.isSafeInteger(stateRetentionMs)) {
      context.addIssue({
        code: 'custom',
        message: 'breaker state retention must be a positive safe integer',
        path: ['breaker'],
      });
    }
  });

export type FixedWindowRateProfile = Readonly<{
  limit: number;
  windowMs: number;
  scope: string;
}>;

export type BreakerProfile = Readonly<{
  scope: string;
  failureThreshold: number;
  failureWindowMs: number;
  cooldownMs: number;
  probeTimeoutMs: number;
}>;

type ParsedGatewayRouteProfile = z.infer<typeof gatewayRouteProfileSchema>;

export type GatewayRouteProfile = Readonly<
  Omit<ParsedGatewayRouteProfile, 'admissionRate' | 'upstreamBudget' | 'breaker'> & {
    admissionRate: FixedWindowRateProfile;
    upstreamBudget: FixedWindowRateProfile;
    breaker: BreakerProfile;
  }
>;
export type GatewayRouteProfileInput = z.input<typeof gatewayRouteProfileSchema>;

export function assertRouteProfile(input: unknown): asserts input is GatewayRouteProfile {
  gatewayRouteProfileSchema.parse(input);
}

export function createRouteProfile(input: GatewayRouteProfileInput): GatewayRouteProfile {
  return freezeRouteProfile(gatewayRouteProfileSchema.parse(input));
}

export function freezeRouteProfile(profile: GatewayRouteProfile): GatewayRouteProfile {
  Object.freeze(profile.admissionRate);
  Object.freeze(profile.upstreamBudget);
  Object.freeze(profile.breaker);
  return Object.freeze(profile);
}

const addPolicyDuration = (durationMs: number, safetyMs: number, label: string): number => {
  const result = durationMs + safetyMs;

  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }

  return result;
};

export function deriveBreakerPolicy(profile: GatewayRouteProfile): BreakerPolicy {
  const closedCompletionBoundMs = addPolicyDuration(
    profile.upstreamTimeoutMs,
    profile.lockSafetyMs,
    'Breaker closed completion bound',
  );
  const halfOpenLeaseMs = addPolicyDuration(
    Math.min(profile.upstreamTimeoutMs, profile.breaker.probeTimeoutMs),
    profile.lockSafetyMs,
    'Breaker half-open lease',
  );
  const stateRetentionMs = addPolicyDuration(
    Math.max(profile.breaker.failureWindowMs, profile.breaker.cooldownMs, halfOpenLeaseMs, closedCompletionBoundMs),
    profile.lockSafetyMs,
    'Breaker state retention',
  );

  return {
    failureThreshold: profile.breaker.failureThreshold,
    failureWindowMs: profile.breaker.failureWindowMs,
    cooldownMs: profile.breaker.cooldownMs,
    halfOpenLeaseMs,
    closedCompletionBoundMs,
    stateRetentionMs,
  };
}
