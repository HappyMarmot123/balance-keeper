import type { FleetStateStore } from '../cache';
import { readKmaWeatherCredential } from '../providers/kma';
import { createWeatherRoute } from '../routes/weather';
import { createGatewayRuntime, type GatewayRuntime } from './createGatewayRuntime';
import { createJsonGatewayLogger, type GatewayLogWriter } from './jsonGatewayLogger';
import type { RuntimeEnvironment } from './runtimeConfig';
import { readTrustedAdmissionSubject } from './trustedAdmissionSubject';

let productionRuntime: GatewayRuntime | undefined;

export class ProductionRuntimeConfigurationError extends Error {
  constructor(cause: unknown) {
    super('Production gateway runtime configuration is invalid', { cause });
    this.name = 'ProductionRuntimeConfigurationError';
  }
}

export type CreateProductionGatewayRuntimeOptions = Readonly<{
  clock?: () => number;
  createCoordinationToken?: () => string;
  createRequestId?: () => string;
  environment?: RuntimeEnvironment;
  fetcher?: typeof fetch;
  fleetStateStore?: FleetStateStore;
  logWriter?: GatewayLogWriter;
}>;

export function createProductionGatewayRuntime(options: CreateProductionGatewayRuntimeOptions = {}): GatewayRuntime {
  const environment = options.environment ?? process.env;
  const clock = options.clock ?? Date.now;
  const weatherRoute = createWeatherRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: readKmaWeatherCredential(environment),
  });

  return createGatewayRuntime({
    clock,
    ...(options.createCoordinationToken === undefined
      ? {}
      : { createCoordinationToken: options.createCoordinationToken }),
    ...(options.createRequestId === undefined ? {} : { createRequestId: options.createRequestId }),
    environment,
    ...(options.fleetStateStore === undefined ? {} : { fleetStateStore: options.fleetStateStore }),
    logger: createJsonGatewayLogger(options.logWriter),
    routes: [weatherRoute],
  });
}

export function getProductionGatewayRuntime(): GatewayRuntime {
  if (productionRuntime === undefined) {
    try {
      productionRuntime = createProductionGatewayRuntime();
    } catch (error) {
      throw new ProductionRuntimeConfigurationError(error);
    }
  }

  return productionRuntime;
}
