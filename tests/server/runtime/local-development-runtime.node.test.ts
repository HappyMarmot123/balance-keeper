// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import {
  createLocalDevelopmentGatewayRuntime,
  LOCAL_DEVELOPMENT_SERVER_CONFIG,
} from '../../../src/server/runtime/localDevelopmentRuntime';

describe('local development gateway runtime', () => {
  it('keeps the local API on the fixed loopback proxy target regardless of environment overrides', () => {
    expect(LOCAL_DEVELOPMENT_SERVER_CONFIG).toEqual({
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:8787',
      port: 8787,
      shutdownTimeoutMs: 10_000,
    });
  });

  it('uses explicit process-local fleet state without weakening the production runtime', async () => {
    const localRuntime = createLocalDevelopmentGatewayRuntime({
      createCoordinationToken: () => 'local-coordination',
      createRequestId: () => 'local-request',
      environment: {},
      logWriter: () => undefined,
    });
    const localResponse = await localRuntime.handle(
      withTrustedAdmissionSubject(new Request('http://127.0.0.1:8787/api/weather?region=seoul'), '203.0.113.20'),
    );

    expect(localResponse.status).toBe(503);
    await expect(localResponse.json()).resolves.toEqual({
      error: {
        code: 'MISSING_CREDENTIALS',
        requestId: 'local-request',
      },
    });

    const productionResponse = await createProductionGatewayRuntime({
      createRequestId: () => 'production-request',
      environment: {},
      logWriter: () => undefined,
    }).handle(
      withTrustedAdmissionSubject(new Request('http://127.0.0.1:8787/api/weather?region=seoul'), '203.0.113.21'),
    );

    expect(productionResponse.status).toBe(503);
    await expect(productionResponse.json()).resolves.toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        requestId: 'production-request',
      },
    });
  });
});
