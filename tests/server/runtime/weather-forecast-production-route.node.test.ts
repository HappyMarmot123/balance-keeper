// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { weatherForecastDataSchema } from '../../../src/entities/weather/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import {
  createGatewayRuntime,
  createProductionGatewayRuntime,
  withTrustedAdmissionSubject,
} from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const fixturePath = resolve(import.meta.dirname, '../../fixtures/kma/short-term-forecast-success.json');
const readFixture = (): unknown => JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

describe('weather forecast production route registration', () => {
  it('registers current weather and forecast only in the production assembly with their independent CDN profiles', () => {
    const productionRuntime = createProductionGatewayRuntime({
      environment: {},
      logWriter: () => undefined,
    });
    const genericRuntime = createGatewayRuntime({
      environment: {},
      fleetStateStore: new MemoryFleetStateStore(() => 1_000),
    });

    expect(productionRuntime.getCdnMaxAgeSeconds('/api/weather')).toBe(5 * 60);
    expect(productionRuntime.getCdnMaxAgeSeconds('/api/weather/forecast')).toBe(15 * 60);
    expect(genericRuntime.getCdnMaxAgeSeconds('/api/weather/forecast')).toBeUndefined();
  });

  it('serves a strict forecast MISS then HIT through getVilageFcst with the canonical data.go.kr key', async () => {
    const now = Date.parse('2026-07-31T08:20:00+09:00');
    const serviceKey = 'canonical-forecast-fixture-key';
    let providerRequestCount = 0;
    let requestSequence = 0;
    let requestedUrl: URL | undefined;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      providerRequestCount += 1;
      requestedUrl = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
      return Response.json(readFixture());
    };
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-weather-forecast',
      createRequestId: () => `request-weather-forecast-${++requestSequence}`,
      environment: { DATA_GO_KR_SERVICE_KEY: serviceKey },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = () =>
      withTrustedAdmissionSubject(
        new Request('https://balance.test/api/weather/forecast?region=seoul'),
        '203.0.113.40',
      );

    const missResponse = await runtime.handle(request());
    const missEnvelope = successEnvelopeSchema(weatherForecastDataSchema).parse(await missResponse.json());
    const hitResponse = await runtime.handle(request());
    const hitEnvelope = successEnvelopeSchema(weatherForecastDataSchema).parse(await hitResponse.json());

    expect(missResponse.status).toBe(200);
    expect(missEnvelope).toMatchObject({
      data: {
        issuedAt: Date.parse('2026-07-31T08:00:00+09:00'),
        region: 'seoul',
      },
      meta: {
        cache: 'MISS',
        fetchedAt: now,
        requestId: 'request-weather-forecast-1',
        source: 'KMA',
      },
    });
    expect(missEnvelope.data?.periods).toHaveLength(24);
    expect(hitResponse.status).toBe(200);
    expect(hitEnvelope.data).toEqual(missEnvelope.data);
    expect(hitEnvelope.meta).toMatchObject({
      cache: 'HIT',
      fetchedAt: now,
      requestId: 'request-weather-forecast-2',
      source: 'KMA',
    });
    expect(providerRequestCount).toBe(1);
    expect(requestedUrl?.pathname).toBe('/1360000/VilageFcstInfoService_2.0/getVilageFcst');
    expect(requestedUrl?.searchParams.get('ServiceKey')).toBe(serviceKey);
    expect(JSON.stringify([missEnvelope, hitEnvelope])).not.toContain(serviceKey);
  });

  it('returns a safe missing-credential response without calling KMA', async () => {
    const now = Date.parse('2026-07-31T08:20:00+09:00');
    const fetcher = vi.fn<typeof fetch>();
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-weather-forecast-missing',
      createRequestId: () => 'request-weather-forecast-missing',
      environment: {},
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const response = await runtime.handle(
      withTrustedAdmissionSubject(
        new Request('https://balance.test/api/weather/forecast?region=seoul'),
        '203.0.113.41',
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'MISSING_CREDENTIALS',
        requestId: 'request-weather-forecast-missing',
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
