import { createGatewayRuntime, type GatewayRuntime } from './createGatewayRuntime';
import { createJsonGatewayLogger, type GatewayLogWriter } from './jsonGatewayLogger';
import type { RuntimeEnvironment } from './runtimeConfig';

let productionRuntime: GatewayRuntime | undefined;

export class ProductionRuntimeConfigurationError extends Error {
  constructor(cause: unknown) {
    super('Production gateway runtime configuration is invalid', { cause });
    this.name = 'ProductionRuntimeConfigurationError';
  }
}

export type CreateProductionGatewayRuntimeOptions = Readonly<{
  environment?: RuntimeEnvironment;
  logWriter?: GatewayLogWriter;
}>;

export function createProductionGatewayRuntime(options: CreateProductionGatewayRuntimeOptions = {}): GatewayRuntime {
  return createGatewayRuntime({
    environment: options.environment ?? process.env,
    logger: createJsonGatewayLogger(options.logWriter),
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
