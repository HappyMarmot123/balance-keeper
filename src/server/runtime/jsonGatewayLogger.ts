import type { GatewayLogEvent, GatewayLogger } from '../observability';

export type GatewayLogWriter = (line: string) => void;

const writeToStandardOutput: GatewayLogWriter = (line) => {
  process.stdout.write(line);
};

export function createJsonGatewayLogger(write: GatewayLogWriter = writeToStandardOutput): GatewayLogger {
  return (event: GatewayLogEvent) => {
    const safeEvent: GatewayLogEvent = {
      event: event.event,
      route: event.route,
      phase: event.phase,
      outcome: event.outcome,
      durationMs: event.durationMs,
      requestId: event.requestId,
      ...(event.cacheStatus === undefined ? {} : { cacheStatus: event.cacheStatus }),
      ...(event.breakerState === undefined ? {} : { breakerState: event.breakerState }),
      ...(event.upstreamStatus === undefined ? {} : { upstreamStatus: event.upstreamStatus }),
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
    };

    write(`${JSON.stringify(safeEvent)}\n`);
  };
}
