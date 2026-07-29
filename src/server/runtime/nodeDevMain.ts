import { createLocalDevelopmentGatewayRuntime, LOCAL_DEVELOPMENT_SERVER_CONFIG } from './localDevelopmentRuntime';
import { installNodeShutdownHandlers, startProductionNodeServer } from './nodeServer';

try {
  const environment = process.env;
  const running = await startProductionNodeServer({
    config: LOCAL_DEVELOPMENT_SERVER_CONFIG,
    runtime: createLocalDevelopmentGatewayRuntime({ environment }),
  });
  installNodeShutdownHandlers(running.close, process, () => {
    process.stderr.write('Balance Keeper local API shutdown failed\n');
    process.exitCode = 1;
  });
  process.stdout.write(`Balance Keeper local API listening on port ${running.port}\n`);
} catch {
  process.stderr.write('Balance Keeper local API failed to start\n');
  process.exitCode = 1;
}
