import type { z } from 'zod';

import { AppError, isAppError } from '../../shared/contracts';
import type { GatewayRouteProfile } from './routeProfile';

declare const opaqueAdmissionSubjectBrand: unique symbol;

export const GATEWAY_MEDIA_MAX_BODY_BYTES = 512 * 1_024;

export type OpaqueAdmissionSubject = string & {
  readonly [opaqueAdmissionSubjectBrand]: true;
};

export type ParsedGatewayRequest<Input, PublicCacheIdentity = unknown> = Readonly<{
  input: Input;
  publicCacheIdentity: PublicCacheIdentity;
  admissionSubject: OpaqueAdmissionSubject;
}>;

type UpstreamResult<Data, Kind extends 'value' | 'empty'> = Readonly<{
  kind: Kind;
  data: Data;
  source: string;
  fetchedAt: number;
}>;

export type UpstreamOutcome<Data = unknown> = UpstreamResult<Data, 'value'> | UpstreamResult<Data, 'empty'>;

export type GatewayMediaOutcome = Readonly<{
  body: Uint8Array;
  contentType: 'image/jpeg';
  fetchedAt: number;
  kind: 'media';
  source: string;
}>;

export interface GatewayRoute<
  Input = unknown,
  PublicCacheIdentity = unknown,
  DataSchema extends z.ZodType = z.ZodType,
> {
  readonly id: string;
  readonly path: `/api/${string}`;
  readonly dataSchema: DataSchema;
  parseRequest(
    request: Request,
  ): ParsedGatewayRequest<Input, PublicCacheIdentity> | Promise<ParsedGatewayRequest<Input, PublicCacheIdentity>>;
  /**
   * Expected provider transport, response-body, raw-schema, and normalization failures must be caught at that
   * boundary and passed to `rethrowAsUpstreamUnavailable`. Throws outside that explicit boundary are treated as
   * programmer defects and remain INTERNAL instead of being hidden by stale data.
   */
  load(input: Input, signal: AbortSignal): Promise<UpstreamOutcome<unknown>>;
  readonly profile: GatewayRouteProfile;
}

export interface GatewayNoStoreRoute<
  Input = unknown,
  PublicCacheIdentity = unknown,
  DataSchema extends z.ZodType = z.ZodType,
> {
  readonly kind: 'no-store';
  readonly id: string;
  readonly path: `/api/${string}`;
  readonly dataSchema: DataSchema;
  parseRequest(
    request: Request,
  ): ParsedGatewayRequest<Input, PublicCacheIdentity> | Promise<ParsedGatewayRequest<Input, PublicCacheIdentity>>;
  load(input: Input, signal: AbortSignal): Promise<UpstreamOutcome<unknown>>;
  readonly profile: GatewayRouteProfile;
}

export interface GatewayMediaRoute<Input = unknown, PublicCacheIdentity = unknown> {
  readonly kind: 'media';
  readonly id: string;
  readonly path: `/api/${string}`;
  parseRequest(
    request: Request,
  ): ParsedGatewayRequest<Input, PublicCacheIdentity> | Promise<ParsedGatewayRequest<Input, PublicCacheIdentity>>;
  load(input: Input, signal: AbortSignal): Promise<GatewayMediaOutcome>;
  readonly profile: GatewayRouteProfile;
}

export type GatewayJsonRoute = GatewayRoute | GatewayNoStoreRoute;
export type GatewayUncachedRoute = GatewayMediaRoute | GatewayNoStoreRoute;
export type RegisteredGatewayRoute = GatewayRoute | GatewayUncachedRoute;

export function isGatewayMediaRoute(route: RegisteredGatewayRoute): route is GatewayMediaRoute {
  return 'kind' in route && route.kind === 'media';
}

export function isGatewayNoStoreRoute(route: RegisteredGatewayRoute): route is GatewayNoStoreRoute {
  return 'kind' in route && route.kind === 'no-store';
}

export function isGatewayUncachedRoute(route: RegisteredGatewayRoute): route is GatewayUncachedRoute {
  return isGatewayMediaRoute(route) || isGatewayNoStoreRoute(route);
}

/**
 * Reclassifies only failures caught at an expected provider boundary. Keep the catch scope narrow: do not wrap an
 * entire route loader, because unknown implementation defects must remain visible as INTERNAL failures.
 */
export function rethrowAsUpstreamUnavailable(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) {
    throw signal.reason;
  }

  if (isAppError(error)) {
    throw error;
  }

  throw new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
}

export function createAdmissionSubject(value: string): OpaqueAdmissionSubject {
  if (value.trim().length === 0) {
    throw new TypeError('admissionSubject must not be empty');
  }

  return value as OpaqueAdmissionSubject;
}
