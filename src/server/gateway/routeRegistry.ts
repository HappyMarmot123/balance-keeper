import type { GatewayRoute } from './route';
import {
  assertRouteProfile,
  type BreakerProfile,
  deriveBreakerPolicy,
  type FixedWindowRateProfile,
  freezeRouteProfile,
  type GatewayRouteProfile,
} from './routeProfile';

const safeRouteIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const safeApiPathPattern = /^\/api\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const MAX_ROUTE_ID_LENGTH = 64;

export type RouteRegistry = Readonly<{
  getByPath(pathname: string): GatewayRoute | undefined;
}>;

type FixedWindowValues = Pick<FixedWindowRateProfile, 'limit' | 'windowMs'>;
type BreakerValues = Omit<BreakerProfile, 'scope'> &
  Readonly<{
    closedCompletionBoundMs: number;
    halfOpenLeaseMs: number;
    stateRetentionMs: number;
  }>;

const assertConsistentFixedWindow = (
  policyName: string,
  policiesByScope: Map<string, FixedWindowValues>,
  policy: FixedWindowRateProfile,
): void => {
  const registered = policiesByScope.get(policy.scope);

  if (registered !== undefined && (registered.limit !== policy.limit || registered.windowMs !== policy.windowMs)) {
    throw new TypeError(`conflicting ${policyName} policy for shared scope`);
  }

  policiesByScope.set(policy.scope, { limit: policy.limit, windowMs: policy.windowMs });
};

const assertConsistentBreaker = (policiesByScope: Map<string, BreakerValues>, profile: GatewayRouteProfile): void => {
  const policy = profile.breaker;
  const registered = policiesByScope.get(policy.scope);
  const derived = deriveBreakerPolicy(profile);

  if (
    registered !== undefined &&
    (registered.failureThreshold !== policy.failureThreshold ||
      registered.failureWindowMs !== policy.failureWindowMs ||
      registered.cooldownMs !== policy.cooldownMs ||
      registered.probeTimeoutMs !== policy.probeTimeoutMs ||
      registered.halfOpenLeaseMs !== derived.halfOpenLeaseMs ||
      registered.closedCompletionBoundMs !== derived.closedCompletionBoundMs ||
      registered.stateRetentionMs !== derived.stateRetentionMs)
  ) {
    throw new TypeError('conflicting breaker policy for shared scope');
  }

  policiesByScope.set(policy.scope, {
    failureThreshold: policy.failureThreshold,
    failureWindowMs: policy.failureWindowMs,
    cooldownMs: policy.cooldownMs,
    probeTimeoutMs: policy.probeTimeoutMs,
    halfOpenLeaseMs: derived.halfOpenLeaseMs,
    closedCompletionBoundMs: derived.closedCompletionBoundMs,
    stateRetentionMs: derived.stateRetentionMs,
  });
};

export function createRouteRegistry(routes: readonly GatewayRoute[]): RouteRegistry {
  const routeIds = new Set<string>();
  const routesByPath = new Map<string, GatewayRoute>();
  const admissionPoliciesByScope = new Map<string, FixedWindowValues>();
  const upstreamPoliciesByScope = new Map<string, FixedWindowValues>();
  const breakerPoliciesByScope = new Map<string, BreakerValues>();

  for (const route of routes) {
    if (route.id.length > MAX_ROUTE_ID_LENGTH || !safeRouteIdPattern.test(route.id)) {
      throw new TypeError('route id must be a safe route id');
    }

    if (!safeApiPathPattern.test(route.path)) {
      throw new TypeError('route path must be a safe canonical /api pathname');
    }

    assertRouteProfile(route.profile);

    if (routeIds.has(route.id)) {
      throw new TypeError('duplicate route id');
    }

    if (routesByPath.has(route.path)) {
      throw new TypeError('duplicate route path');
    }

    assertConsistentFixedWindow('admission rate', admissionPoliciesByScope, route.profile.admissionRate);
    assertConsistentFixedWindow('upstream budget', upstreamPoliciesByScope, route.profile.upstreamBudget);
    assertConsistentBreaker(breakerPoliciesByScope, route.profile);

    routeIds.add(route.id);
    routesByPath.set(route.path, route);
  }

  for (const route of routes) {
    freezeRouteProfile(route.profile);
    Object.freeze(route);
  }

  return Object.freeze({
    getByPath(pathname: string) {
      return routesByPath.get(pathname);
    },
  });
}
