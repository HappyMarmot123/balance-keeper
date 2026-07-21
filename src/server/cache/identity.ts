import { createHash } from 'node:crypto';
import { canonicalJson } from './canonicalJson';

const routeIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const stateScopePattern = /^(?:route|provider)\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const sha256Base64Url = (value: string): string => createHash('sha256').update(value, 'utf8').digest('base64url');

const assertRouteId = (routeId: string): void => {
  if (routeId.length > 64 || !routeIdPattern.test(routeId)) {
    throw new TypeError('Route id must be a lowercase kebab-case identifier of at most 64 characters');
  }
};

const assertStateScope = (scope: string): void => {
  if (scope.length > 96 || !stateScopePattern.test(scope)) {
    throw new TypeError('State scope must be a route.* or provider.* lowercase identifier of at most 96 characters');
  }
};

export function createCacheKey(routeId: string, publicIdentity: unknown): string {
  assertRouteId(routeId);
  const digest = sha256Base64Url(canonicalJson(publicIdentity));
  return `bk:v1:cache:${routeId}:${digest}`;
}

export type StateKeyKind = 'lease' | 'rate' | 'breaker';

const stateKeyKinds: ReadonlySet<string> = new Set<StateKeyKind>(['lease', 'rate', 'breaker']);

export function createStateKey(kind: StateKeyKind, scope: string, identity: unknown = null): string {
  if (!stateKeyKinds.has(kind)) {
    throw new TypeError('Unknown fleet-state key kind');
  }

  assertStateScope(scope);
  const digest = sha256Base64Url(canonicalJson(identity));
  return `bk:v1:state:${kind}:${scope}:${digest}`;
}

export type EtagRepresentation<Data = unknown> = Readonly<{
  data: Data;
  source: string;
  fetchedAt: number;
  kind: 'value' | 'empty';
  degraded: boolean;
}>;

export function createWeakEtag<Data>({ data, source, fetchedAt, kind, degraded }: EtagRepresentation<Data>): string {
  const digest = sha256Base64Url(
    canonicalJson({
      data,
      degraded,
      fetchedAt,
      kind,
      source,
    }),
  );

  return `W/"bk1-${digest}"`;
}
