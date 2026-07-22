import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import {
  createGatewayRuntime,
  createProductionGatewayRuntime,
  withTrustedAdmissionSubject,
} from '../../../src/server/runtime';

const fixturePath = resolve(import.meta.dirname, '../../fixtures/kma/ultra-short-nowcast-success.json');
const readFixture = (): unknown => JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

describe('weather production route registration', () => {
  it('registers /api/weather with its CDN profile in the production assembly', () => {
    const runtime = createProductionGatewayRuntime({
      environment: {},
      logWriter: () => undefined,
    });

    expect(runtime.getCdnMaxAgeSeconds('/api/weather')).toBe(300);
  });

  it('keeps the reusable gateway runtime empty when no synthetic routes are injected', () => {
    const runtime = createGatewayRuntime({
      environment: {},
      fleetStateStore: new MemoryFleetStateStore(() => 1_000),
    });

    expect(runtime.getCdnMaxAgeSeconds('/api/weather')).toBeUndefined();
  });

  it('does not treat the legacy earthquake variable as the canonical weather credential', async () => {
    const now = Date.parse('2026-07-22T14:25:00+09:00');
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-weather-runtime',
      createRequestId: () => 'request-weather-runtime',
      environment: { KOREA_EARTHQUAKE_KEY: 'legacy-fixture-key' },
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = withTrustedAdmissionSubject(
      new Request('https://balance.test/api/weather?region=seoul'),
      '203.0.113.10',
    );
    const response = await runtime.handle(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: { code: 'MISSING_CREDENTIALS', requestId: 'request-weather-runtime' },
    });
    expect(JSON.stringify(body)).not.toContain('legacy-fixture-key');
  });

  it('serves a strict KMA envelope through the production factory with only the canonical key', async () => {
    const now = Date.parse('2026-07-22T14:25:00+09:00');
    let requestedUrl: URL | undefined;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      requestedUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify(readFixture()), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    };
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-weather-success',
      createRequestId: () => 'request-weather-success',
      environment: { DATA_GO_KR_SERVICE_KEY: 'canonical-fixture-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = withTrustedAdmissionSubject(
      new Request('https://balance.test/api/weather?region=seoul'),
      '203.0.113.11',
    );

    const response = await runtime.handle(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        region: 'seoul',
        observedAt: Date.parse('2026-07-22T14:00:00+09:00'),
        temperatureCelsius: 27.4,
        relativeHumidityPercent: 68,
        precipitationLastHourMm: 0,
        precipitationType: 'none',
        windSpeedMetersPerSecond: 2.5,
        windDirectionDegrees: 270,
      },
      meta: {
        cache: 'MISS',
        fetchedAt: now,
        requestId: 'request-weather-success',
        source: 'KMA',
      },
    });
    expect(requestedUrl?.searchParams.get('base_date')).toBe('20260722');
    expect(requestedUrl?.searchParams.get('base_time')).toBe('1400');
    expect(requestedUrl?.searchParams.get('ServiceKey')).toBe('canonical-fixture-key');
    expect(JSON.stringify(body)).not.toContain('canonical-fixture-key');
  });
});
