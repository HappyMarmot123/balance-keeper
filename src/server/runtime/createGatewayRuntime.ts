import { randomUUID } from 'node:crypto';
import { createUpstashRedisClient, type FleetStateStore, UpstashFleetStateStore } from '../cache';
import { createGatewayHandler, createRouteRegistry, type GatewayRoute, type RouteRegistry } from '../gateway';
import type { GatewayLogger } from '../observability';
import { createLocalCoalescer } from '../resilience';
import { type RuntimeEnvironment, readFleetStateConfig } from './runtimeConfig';
import { createUnavailableFleetStateStore } from './unavailableFleetStateStore';

const productionGatewayRoutes: readonly GatewayRoute[] = Object.freeze([]);

export type CreateGatewayRuntimeOptions = Readonly<{
  clock?: () => number;
  createCoordinationToken?: () => string;
  createRequestId?: () => string;
  environment?: RuntimeEnvironment;
  fleetStateStore?: FleetStateStore;
  logger?: GatewayLogger;
  routes?: readonly GatewayRoute[];
}>;

export type GatewayRuntime = Readonly<{
  getCdnMaxAgeSeconds(pathname: string): number | undefined;
  handle(request: Request): Promise<Response>;
}>;

const createConfiguredFleetStateStore = (environment: RuntimeEnvironment): FleetStateStore => {
  const config = readFleetStateConfig(environment);

  if (config.kind === 'unavailable') {
    return createUnavailableFleetStateStore();
  }

  return new UpstashFleetStateStore(
    createUpstashRedisClient({
      requestTimeoutMs: config.requestTimeoutMs,
      token: config.token,
      url: config.url,
    }),
  );
};

export function createGatewayRuntime(options: CreateGatewayRuntimeOptions = {}): GatewayRuntime {
  const registry: RouteRegistry = createRouteRegistry(options.routes ?? productionGatewayRoutes);
  const handler = createGatewayHandler(registry);
  const clock = options.clock ?? Date.now;
  const dependencies = Object.freeze({
    clock,
    createCoordinationToken: options.createCoordinationToken ?? randomUUID,
    createRequestId: options.createRequestId ?? randomUUID,
    fleetStateStore: options.fleetStateStore ?? createConfiguredFleetStateStore(options.environment ?? process.env),
    localCoalescer: createLocalCoalescer<string>(),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return Object.freeze({
    getCdnMaxAgeSeconds(pathname: string) {
      return registry.getByPath(pathname)?.profile.cdnMaxAgeSeconds;
    },
    handle(request: Request) {
      return handler(request, dependencies);
    },
  });
}
