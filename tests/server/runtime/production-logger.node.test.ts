import { describe, expect, it } from 'vitest';

describe('production gateway logger', () => {
  it('serializes one allowlisted JSON line and drops unexpected fields', async () => {
    const runtime = (await import('../../../src/server/runtime')) as Record<string, unknown>;
    expect(runtime.createJsonGatewayLogger).toEqual(expect.any(Function));

    const lines: string[] = [];
    const logger = (runtime.createJsonGatewayLogger as (write: (line: string) => void) => (event: unknown) => void)(
      (line) => lines.push(line),
    );
    logger({
      durationMs: 3,
      event: 'gateway.request',
      outcome: 'error',
      phase: 'response',
      query: 'token=must-not-log',
      requestId: 'request-logger-1',
      route: 'unmatched',
      secret: 'must-not-log',
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      durationMs: 3,
      event: 'gateway.request',
      outcome: 'error',
      phase: 'response',
      requestId: 'request-logger-1',
      route: 'unmatched',
    });
  });

  it('wires the JSON logger into production assembly without logging raw query data', async () => {
    const runtimeModule = (await import('../../../src/server/runtime')) as Record<string, unknown>;
    expect(runtimeModule.createProductionGatewayRuntime).toEqual(expect.any(Function));

    const lines: string[] = [];
    const runtime = (
      runtimeModule.createProductionGatewayRuntime as (options: unknown) => {
        handle(request: Request): Promise<Response>;
      }
    )({ environment: {}, logWriter: (line: string) => lines.push(line) });

    const response = await runtime.handle(new Request('https://balance.test/api/missing?token=must-not-log'));

    expect(response.status).toBe(404);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('must-not-log');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      errorCode: 'NOT_FOUND',
      event: 'gateway.request',
      outcome: 'error',
      route: 'unmatched',
    });
  });
});
