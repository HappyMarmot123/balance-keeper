import type { CacheStatus, ServerApiErrorCode } from '../../shared/contracts';

export type BreakerLogState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type GatewayLogEvent = Readonly<{
  event: string;
  route: string;
  phase: string;
  outcome: string;
  durationMs: number;
  requestId: string;
  cacheStatus?: CacheStatus;
  breakerState?: BreakerLogState;
  upstreamStatus?: number;
  errorCode?: ServerApiErrorCode;
}>;

export type GatewayLogger = (event: GatewayLogEvent) => void | Promise<void>;

function copyAllowlistedFields(event: GatewayLogEvent): GatewayLogEvent {
  return Object.freeze({
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
  });
}

export function safeLog(logger: GatewayLogger | null | undefined, event: GatewayLogEvent): void {
  if (logger === undefined || logger === null) {
    return;
  }

  try {
    void Promise.resolve(logger(copyAllowlistedFields(event))).catch(() => undefined);
  } catch {
    // Observability is best-effort and must never change the gateway response path.
  }
}
