// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { roadTrafficForecastDataSchema } from '../../../src/entities/road-traffic';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-forecast-success.json', import.meta.url), 'utf8'),
) as unknown;
const start = Date.parse('2026-08-03T15:20:00+09:00');
const createRequest = (headers?: HeadersInit) =>
  withTrustedAdmissionSubject(
    new Request('https://balance.test/api/road-traffic/forecast', { headers }),
    '203.0.113.127',
  );
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('road traffic forecast production gateway registration', () => {
  it('serves MISS, HIT and ETag revalidation through the coarse gateway', async () => {
    let requestSequence = 0;
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const runtime = createProductionGatewayRuntime({
      clock: () => start,
      createCoordinationToken: () => 'coordination-road-traffic-forecast',
      createRequestId: () => `request-road-traffic-forecast-${++requestSequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => start),
      logWriter: () => undefined,
    });

    const missResponse = await runtime.handle(createRequest());
    expect(missResponse.status).toBe(200);
    const etag = missResponse.headers.get('etag');
    expect(etag).not.toBeNull();
    const missEnvelope = successEnvelopeSchema(roadTrafficForecastDataSchema).parse(await missResponse.json());
    expect(missEnvelope.meta).toMatchObject({
      cache: 'MISS',
      source: expect.stringContaining('국가교통정보센터'),
    });
    expect(missEnvelope.data.segments).toHaveLength(2);
    expect(JSON.stringify(missEnvelope)).not.toContain('synthetic-its-secret');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const hitResponse = await runtime.handle(createRequest());
    const hitEnvelope = successEnvelopeSchema(roadTrafficForecastDataSchema).parse(await hitResponse.json());
    expect(hitEnvelope.meta.cache).toBe('HIT');
    expect(hitEnvelope.data).toEqual(missEnvelope.data);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const notModified = await runtime.handle(createRequest({ 'If-None-Match': etag ?? '' }));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains the last good forecast when ITS fails inside the stale window', async () => {
    let now = start;
    let failProvider = false;
    let requestSequence = 0;
    const fetcher = vi.fn(async () => {
      if (failProvider) {
        throw new Error('synthetic transient ITS failure');
      }
      return jsonResponse(successFixture);
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-road-traffic-stale-${requestSequence}`,
      createRequestId: () => `request-road-traffic-stale-${++requestSequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    const missResponse = await runtime.handle(createRequest());
    const missEnvelope = successEnvelopeSchema(roadTrafficForecastDataSchema).parse(await missResponse.json());
    failProvider = true;
    now += 30 * 60_000 + 1;
    const staleResponse = await runtime.handle(createRequest());
    const staleEnvelope = successEnvelopeSchema(roadTrafficForecastDataSchema).parse(await staleResponse.json());

    expect(staleResponse.status).toBe(200);
    expect(staleEnvelope.data).toEqual(missEnvelope.data);
    expect(staleEnvelope.meta).toMatchObject({
      cache: 'STALE',
      fetchedAt: missEnvelope.meta.fetchedAt,
      source: missEnvelope.meta.source,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sanitizes initial provider failures from the response and gateway logs', async () => {
    const logs: string[] = [];
    const fetcher = vi.fn(async () => {
      throw new Error('raw-its-marker apiKey=synthetic-its-secret');
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => start,
      createCoordinationToken: () => 'coordination-road-traffic-failure',
      createRequestId: () => 'request-road-traffic-failure',
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => start),
      logWriter: (line) => logs.push(line),
    });

    const response = await runtime.handle(createRequest());
    const serialized = JSON.stringify([await response.json(), logs]);

    expect(response.status).toBe(502);
    expect(JSON.parse(serialized)[0]).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
    expect(serialized).not.toContain('synthetic-its-secret');
    expect(serialized).not.toContain('raw-its-marker');
    expect(serialized).not.toContain('apiKey=');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
