import { MemoryFleetStateStore } from '../cache';
import type { NodeServerConfig } from './nodeServerConfig';
import { type CreateProductionGatewayRuntimeOptions, createProductionGatewayRuntime } from './productionRuntime';

export const LOCAL_DEVELOPMENT_SERVER_CONFIG = Object.freeze({
  host: '127.0.0.1',
  origin: 'http://127.0.0.1:8787',
  port: 8_787,
  shutdownTimeoutMs: 10_000,
} satisfies NodeServerConfig);

export type CreateLocalDevelopmentGatewayRuntimeOptions = Omit<
  CreateProductionGatewayRuntimeOptions,
  'fleetStateStore'
>;

export function createLocalDevelopmentGatewayRuntime(options: CreateLocalDevelopmentGatewayRuntimeOptions = {}) {
  const clock = options.clock ?? Date.now;

  return createProductionGatewayRuntime({
    ...options,
    clock,
    fleetStateStore: new MemoryFleetStateStore(clock),
  });
}
