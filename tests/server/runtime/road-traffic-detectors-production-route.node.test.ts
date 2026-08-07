// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { roadTrafficDetectorDataSchema } from '../../../src/entities/road-traffic';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-detectors-success.json', import.meta.url), 'utf8'),
) as unknown;
const start = Date.parse('2026-08-07T12:02:00+09:00');
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const createRequest = (headers?: HeadersInit) =>
  withTrustedAdmissionSubject(
    new Request('https://balance.test/api/road-traffic/detectors', { headers }),
    '203.0.113.137',
  );

describe('road traffic detector production gateway registration', () => {
  it('serves singleton MISS, HIT and bodyless ETag revalidation with one provider call', async () => {
    let sequence = 0;
    const fetcher = vi.fn(async () => jsonResponse(fixture));
    const runtime = createProductionGatewayRuntime({
      clock: () => start,
      createCoordinationToken: () => 'coordination-detectors',
      createRequestId: () => `request-detectors-${++sequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => start),
      logWriter: () => undefined,
    });

    const miss = await runtime.handle(createRequest());
    expect(miss.status).toBe(200);
    const etag = miss.headers.get('etag');
    const missEnvelope = successEnvelopeSchema(roadTrafficDetectorDataSchema).parse(await miss.json());
    expect(missEnvelope.meta.cache).toBe('MISS');
    expect(missEnvelope.data.detectors).toHaveLength(2);
    expect(JSON.stringify(missEnvelope)).not.toContain('synthetic-its-secret');

    const hit = await runtime.handle(createRequest());
    expect(successEnvelopeSchema(roadTrafficDetectorDataSchema).parse(await hit.json()).meta.cache).toBe('HIT');
    const notModified = await runtime.handle(createRequest({ 'If-None-Match': etag ?? '' }));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent nationwide misses and serves last-good stale data after expiry', async () => {
    let now = start;
    let rejectProvider = false;
    let sequence = 0;
    const fetcher = vi.fn(async () => {
      if (rejectProvider) throw new Error('synthetic detector failure');
      return jsonResponse(fixture);
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-detectors-${sequence}`,
      createRequestId: () => `request-detectors-${++sequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    const [first, second] = await Promise.all([runtime.handle(createRequest()), runtime.handle(createRequest())]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const firstEnvelope = successEnvelopeSchema(roadTrafficDetectorDataSchema).parse(await first.json());

    rejectProvider = true;
    now += 5 * 60_000 + 1;
    const stale = await runtime.handle(createRequest());
    const staleEnvelope = successEnvelopeSchema(roadTrafficDetectorDataSchema).parse(await stale.json());
    expect(staleEnvelope.meta.cache).toBe('STALE');
    expect(staleEnvelope.meta.fetchedAt).toBe(firstEnvelope.meta.fetchedAt);
    expect(staleEnvelope.data).toEqual(firstEnvelope.data);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sanitizes initial provider failures from response and logs', async () => {
    const logs: string[] = [];
    const fetcher = vi.fn(async () => {
      throw new Error('raw-detector-marker apiKey=synthetic-its-secret');
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => start,
      createCoordinationToken: () => 'coordination-detector-failure',
      createRequestId: () => 'request-detector-failure',
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
    expect(serialized).not.toContain('raw-detector-marker');
    expect(serialized).not.toContain('apiKey=');
  });
});
