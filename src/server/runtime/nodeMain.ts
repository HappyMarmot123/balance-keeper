import { installNodeShutdownHandlers, startProductionNodeServer } from './nodeServer';

try {
  const running = await startProductionNodeServer();
  installNodeShutdownHandlers(running.close, process, () => {
    process.stderr.write('Balance Keeper API shutdown failed\n');
    process.exitCode = 1;
  });
  process.stdout.write(`Balance Keeper API listening on port ${running.port}\n`);
} catch {
  process.stderr.write('Balance Keeper API failed to start\n');
  process.exitCode = 1;
}
