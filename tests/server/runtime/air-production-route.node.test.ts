// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { airQualityDataSchema } from '../../../src/entities/air-quality/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import {
  createGatewayRuntime,
  createProductionGatewayRuntime,
  withTrustedAdmissionSubject,
} from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const measurementFixturePath = resolve(import.meta.dirname, '../../fixtures/airkorea/measurement-success.json');
const stationFixturePath = resolve(import.meta.dirname, '../../fixtures/airkorea/station-directory-success.json');
const readFixture = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;
const syntheticEnvironment = {
  KOREA_AIR_QUALITY_BASE_URL: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
  KOREA_AIR_QUALITY_KEY: 'synthetic-measurement-key',
  KOREA_AIR_STATION_BASE_URL: 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc',
  KOREA_AIR_STATION_KEY: 'synthetic-station-key',
} as const;

describe('air-quality production route registration', () => {
  it('registers /api/air beside weather with its own CDN profile', () => {
    const runtime = createProductionGatewayRuntime({
      environment: {},
      logWriter: () => undefined,
    });

    expect(runtime.getCdnMaxAgeSeconds('/api/air')).toBe(15 * 60);
    expect(runtime.getCdnMaxAgeSeconds('/api/weather')).toBe(5 * 60);
  });

  it('keeps the reusable gateway runtime empty when no synthetic routes are injected', () => {
    const runtime = createGatewayRuntime({ environment: {} });

    expect(runtime.getCdnMaxAgeSeconds('/api/air')).toBeUndefined();
  });

  it('serves a strict envelope and reuses the canonical cache across region aliases', async () => {
    const now = Date.parse('2026-06-15T09:05:00+09:00');
    const requestedUrls: URL[] = [];
    let requestSequence = 0;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      requestedUrls.push(url);

      const fixture = url.pathname.endsWith('/getCtprvnRltmMesureDnsty')
        ? readFixture(measurementFixturePath)
        : url.pathname.endsWith('/getMsrstnList')
          ? readFixture(stationFixturePath)
          : undefined;

      return fixture === undefined ? new Response(null, { status: 404 }) : Response.json(fixture);
    };
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-air-runtime',
      createRequestId: () => `request-air-${++requestSequence}`,
      environment: syntheticEnvironment,
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = (region: string) =>
      withTrustedAdmissionSubject(new Request(`https://balance.test/api/air?region=${region}`), '203.0.113.20');

    const missResponse = await runtime.handle(request('seoul'));
    const missEnvelope = successEnvelopeSchema(airQualityDataSchema).parse(await missResponse.json());
    const hitResponse = await runtime.handle(request(encodeURIComponent('서울')));
    const hitEnvelope = successEnvelopeSchema(airQualityDataSchema).parse(await hitResponse.json());

    expect(missResponse.status).toBe(200);
    expect(missEnvelope).toMatchObject({
      data: {
        observedStationCount: 4,
        region: 'seoul',
        totalStationCount: 5,
      },
      meta: {
        cache: 'MISS',
        fetchedAt: now,
        requestId: 'request-air-1',
        source: 'AirKorea',
      },
    });
    expect(hitResponse.status).toBe(200);
    expect(hitEnvelope).toMatchObject({
      data: { region: 'seoul' },
      meta: { cache: 'HIT', requestId: 'request-air-2' },
    });
    expect(requestedUrls).toHaveLength(2);
    expect(
      requestedUrls.find((url) => url.pathname.endsWith('/getCtprvnRltmMesureDnsty'))?.searchParams.get('sidoName'),
    ).toBe('서울');
    expect(requestedUrls.find((url) => url.pathname.endsWith('/getMsrstnList'))?.searchParams.get('addr')).toBe('서울');

    const serializedEnvelope = JSON.stringify([missEnvelope, hitEnvelope]);
    expect(serializedEnvelope).not.toContain('synthetic-measurement-key');
    expect(serializedEnvelope).not.toContain('synthetic-station-key');
    expect(serializedEnvelope).not.toContain('SYNTHETIC_OK');
  });

  it('retains the last good snapshot when both AirKorea services fail inside the stale window', async () => {
    let now = Date.parse('2026-06-15T09:05:00+09:00');
    let failProvider = false;
    let providerRequestCount = 0;
    let requestSequence = 0;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      providerRequestCount += 1;
      if (failProvider) {
        return new Response(null, { status: 503 });
      }

      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Response.json(
        url.pathname.endsWith('/getCtprvnRltmMesureDnsty')
          ? readFixture(measurementFixturePath)
          : readFixture(stationFixturePath),
      );
    };
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-air-stale-${requestSequence}`,
      createRequestId: () => `request-air-stale-${++requestSequence}`,
      environment: syntheticEnvironment,
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = () =>
      withTrustedAdmissionSubject(new Request('https://balance.test/api/air?region=seoul'), '203.0.113.21');

    const missResponse = await runtime.handle(request());
    const missEnvelope = successEnvelopeSchema(airQualityDataSchema).parse(await missResponse.json());
    failProvider = true;
    now += 30 * 60_000 + 1;
    const staleResponse = await runtime.handle(request());
    const staleEnvelope = successEnvelopeSchema(airQualityDataSchema).parse(await staleResponse.json());

    expect(missEnvelope.meta.cache).toBe('MISS');
    expect(staleResponse.status).toBe(200);
    expect(staleEnvelope.data).toEqual(missEnvelope.data);
    expect(staleEnvelope.meta).toMatchObject({
      cache: 'STALE',
      fetchedAt: missEnvelope.meta.fetchedAt,
      requestId: 'request-air-stale-2',
      source: 'AirKorea',
    });
    expect(providerRequestCount).toBe(4);
  });
});
