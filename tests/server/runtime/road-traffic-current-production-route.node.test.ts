// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { roadTrafficCurrentDataSchema } from '../../../src/entities/road-traffic';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-current-success.json', import.meta.url), 'utf8'),
) as unknown;
const start = Date.parse('2026-08-03T15:21:00+09:00');
const createRequest = (bbox = '126.95,37.5,127.05,37.6', headers?: HeadersInit) =>
  withTrustedAdmissionSubject(
    new Request(`https://balance.test/api/road-traffic/current?bbox=${bbox}`, { headers }),
    '203.0.113.128',
  );
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('road traffic current production gateway registration', () => {
  it('serves MISS, bbox-partitioned HIT and ETag revalidation through the coarse gateway', async () => {
    let requestSequence = 0;
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const runtime = createProductionGatewayRuntime({
      clock: () => start,
      createCoordinationToken: () => 'coordination-road-traffic-current',
      createRequestId: () => `request-road-traffic-current-${++requestSequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => start),
      logWriter: () => undefined,
    });

    const missResponse = await runtime.handle(createRequest());
    expect(missResponse.status).toBe(200);
    const etag = missResponse.headers.get('etag');
    expect(etag).not.toBeNull();
    const missEnvelope = successEnvelopeSchema(roadTrafficCurrentDataSchema).parse(await missResponse.json());
    expect(missEnvelope.meta).toMatchObject({ cache: 'MISS', source: expect.stringContaining('국가교통정보센터') });
    expect(missEnvelope.data.bounds).toEqual({
      maximumLatitude: 37.6,
      maximumLongitude: 127.05,
      minimumLatitude: 37.5,
      minimumLongitude: 126.95,
    });
    expect(JSON.stringify(missEnvelope)).not.toContain('synthetic-its-secret');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const hitResponse = await runtime.handle(createRequest());
    const hitEnvelope = successEnvelopeSchema(roadTrafficCurrentDataSchema).parse(await hitResponse.json());
    expect(hitEnvelope.meta.cache).toBe('HIT');
    expect(hitEnvelope.data).toEqual(missEnvelope.data);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const notModified = await runtime.handle(createRequest(undefined, { 'If-None-Match': etag ?? '' }));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const otherBounds = await runtime.handle(createRequest('126.95,37.5,127.04,37.59'));
    expect(otherBounds.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized bbox before upstream access', async () => {
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const runtime = createProductionGatewayRuntime({
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => start),
      logWriter: () => undefined,
    });

    const response = await runtime.handle(createRequest('126.9,37.5,127.05,37.6'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains the last good bbox snapshot inside the stale window', async () => {
    let now = start;
    let failProvider = false;
    let requestSequence = 0;
    const fetcher = vi.fn(async () => {
      if (failProvider) throw new Error('synthetic transient ITS failure');
      return jsonResponse(successFixture);
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-current-stale-${requestSequence}`,
      createRequestId: () => `request-current-stale-${++requestSequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    const miss = successEnvelopeSchema(roadTrafficCurrentDataSchema).parse(
      await (await runtime.handle(createRequest())).json(),
    );
    failProvider = true;
    now += 5 * 60_000 + 1;
    const staleResponse = await runtime.handle(createRequest());
    const stale = successEnvelopeSchema(roadTrafficCurrentDataSchema).parse(await staleResponse.json());

    expect(staleResponse.status).toBe(200);
    expect(stale.data).toEqual(miss.data);
    expect(stale.meta).toMatchObject({ cache: 'STALE', fetchedAt: miss.meta.fetchedAt });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sanitizes initial upstream failures from the response and logs', async () => {
    const logs: string[] = [];
    const fetcher = vi.fn(async () => {
      throw new Error('raw-current-marker apiKey=synthetic-its-secret');
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => start,
      createCoordinationToken: () => 'coordination-current-failure',
      createRequestId: () => 'request-current-failure',
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
    expect(serialized).not.toContain('raw-current-marker');
    expect(serialized).not.toContain('apiKey=');
  });
});
