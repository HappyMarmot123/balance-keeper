// @vitest-environment node

import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { type GatewayLogEvent, type GatewayLogger, safeLog } from '../../../src/server/observability';

const validEvent = {
  event: 'gateway.request',
  route: 'weather',
  phase: 'upstream',
  outcome: 'success',
  durationMs: 37,
  requestId: 'req-01',
  cacheStatus: 'MISS',
  breakerState: 'CLOSED',
  upstreamStatus: 200,
  errorCode: 'UPSTREAM_UNAVAILABLE',
} as const satisfies GatewayLogEvent;

describe('safeLog', () => {
  it('passes only the structured allowlist to the logger', () => {
    const logger = vi.fn<GatewayLogger>();
    const unsafeEvent = {
      ...validEvent,
      url: '/api/weather?providerKey=secret',
      query: 'providerKey=secret',
      identity: '198.51.100.10',
      message: 'upstream body secret',
      cause: new Error('secret cause'),
      stack: 'secret stack',
      extension: { authorization: 'Bearer secret' },
    } as GatewayLogEvent;

    safeLog(logger, unsafeEvent);

    expect(logger).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledWith(validEvent);
    expect(JSON.stringify(logger.mock.calls[0]?.[0])).not.toContain('secret');
    expect(logger.mock.calls[0]?.[0]).not.toBe(unsafeEvent);
  });

  it('does not change caller flow when the logger throws synchronously', () => {
    const logger: GatewayLogger = () => {
      throw new Error('logging unavailable');
    };

    expect(() => safeLog(logger, validEvent)).not.toThrow();
  });

  it('handles a logger rejection without creating an unhandled rejection', async () => {
    const logger: GatewayLogger = () => Promise.reject(new Error('logging unavailable'));

    safeLog(logger, validEvent);
    await setImmediate();
  });

  it('returns immediately without waiting for asynchronous logging', async () => {
    let finishLogging: (() => void) | undefined;
    const logger: GatewayLogger = () =>
      new Promise<void>((resolve) => {
        finishLogging = resolve;
      });

    expect(safeLog(logger, validEvent)).toBeUndefined();
    expect(finishLogging).toBeTypeOf('function');

    finishLogging?.();
    await setImmediate();
  });

  it('is a no-op when no logger adapter is configured', () => {
    expect(() => safeLog(undefined, validEvent)).not.toThrow();
  });
});
