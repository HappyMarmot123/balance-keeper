import type { GatewayRuntime } from './createGatewayRuntime';
import { handleNodeGatewayRequest } from './nodeGatewayAdapter';
import { type RunningNodeHttpServer, startNodeHttpServer } from './nodeHttpAdapter';
import { type NodeServerConfig, readNodeServerConfig } from './nodeServerConfig';
import type { RuntimeEnvironment } from './runtimeConfig';

export type StartProductionNodeServerOptions = Readonly<{
  config?: NodeServerConfig;
  environment?: RuntimeEnvironment;
  runtime?: GatewayRuntime;
}>;

export function startProductionNodeServer(
  options: StartProductionNodeServerOptions = {},
): Promise<RunningNodeHttpServer> {
  const config = options.config ?? readNodeServerConfig(options.environment ?? process.env);

  return startNodeHttpServer({
    ...config,
    handleRequest: (request, context) => handleNodeGatewayRequest(request, context.remoteAddress, options.runtime),
  });
}

export type NodeShutdownSignalSource = Readonly<{
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}>;

export function installNodeShutdownHandlers(
  shutdown: () => Promise<void>,
  signalSource: NodeShutdownSignalSource = process,
  onError: (error: unknown) => void = () => {
    process.exitCode = 1;
  },
): () => void {
  let started = false;
  const onSignal = () => {
    if (started) {
      return;
    }

    started = true;
    void shutdown().catch(onError);
  };

  signalSource.on('SIGINT', onSignal);
  signalSource.on('SIGTERM', onSignal);

  return () => {
    signalSource.off('SIGINT', onSignal);
    signalSource.off('SIGTERM', onSignal);
  };
}
