// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { maritimeTrafficDataSchema } from '../../../src/entities/maritime-traffic';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/komsa/maritime-traffic-success.json', import.meta.url), 'utf8'),
) as unknown;
const start = Date.parse('2026-07-31T12:35:00+09:00');

const createRequest = (headers?: HeadersInit) =>
  withTrustedAdmissionSubject(new Request('https://balance.test/api/maritime-traffic', { headers }), '203.0.113.111');

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('maritime traffic production gateway registration', () => {
  it('serves MISS, HIT and ETag revalidation through the one coarse gateway', async () => {
    let requestSequence = 0;
    const fetcher = vi.fn(async () => jsonResponse(successFixture));
    const runtime = createProductionGatewayRuntime({
      clock: () => start,
      createCoordinationToken: () => 'coordination-maritime-traffic',
      createRequestId: () => `request-maritime-traffic-${++requestSequence}`,
      environment: { DATA_GO_KR_SERVICE_KEY: 'synthetic-data-go-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => start),
      logWriter: () => undefined,
    });

    const missResponse = await runtime.handle(createRequest());
    expect(missResponse.status).toBe(200);
    const etag = missResponse.headers.get('etag');
    expect(etag).not.toBeNull();
    const missEnvelope = successEnvelopeSchema(maritimeTrafficDataSchema).parse(await missResponse.json());
    expect(missEnvelope.meta).toMatchObject({
      cache: 'MISS',
      source: expect.stringContaining('한국해양교통안전공단'),
    });
    expect(missEnvelope.data.cells).toHaveLength(2);
    expect(JSON.stringify(missEnvelope)).not.toContain('synthetic-data-go-key');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const hitResponse = await runtime.handle(createRequest());
    const hitEnvelope = successEnvelopeSchema(maritimeTrafficDataSchema).parse(await hitResponse.json());
    expect(hitEnvelope.meta.cache).toBe('HIT');
    expect(hitEnvelope.data).toEqual(missEnvelope.data);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const notModified = await runtime.handle(createRequest({ 'If-None-Match': etag ?? '' }));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains the last good snapshot when MTIS fails inside the stale window', async () => {
    let now = start;
    let failProvider = false;
    let requestSequence = 0;
    const fetcher = vi.fn(async () => {
      if (failProvider) {
        throw new Error('synthetic transient MTIS failure');
      }
      return jsonResponse(successFixture);
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-maritime-stale-${requestSequence}`,
      createRequestId: () => `request-maritime-stale-${++requestSequence}`,
      environment: { DATA_GO_KR_SERVICE_KEY: 'synthetic-data-go-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    const missResponse = await runtime.handle(createRequest());
    const missEnvelope = successEnvelopeSchema(maritimeTrafficDataSchema).parse(await missResponse.json());
    failProvider = true;
    now += 5 * 60_000 + 1;
    const staleResponse = await runtime.handle(createRequest());
    const staleEnvelope = successEnvelopeSchema(maritimeTrafficDataSchema).parse(await staleResponse.json());

    expect(staleResponse.status).toBe(200);
    expect(staleEnvelope.data).toEqual(missEnvelope.data);
    expect(staleEnvelope.meta).toMatchObject({
      cache: 'STALE',
      fetchedAt: missEnvelope.meta.fetchedAt,
      source: missEnvelope.meta.source,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sanitizes an initial provider failure from the public envelope and gateway logs', async () => {
    const logs: string[] = [];
    const fetcher = vi.fn(async () => {
      throw new Error('raw-mtis-marker serviceKey=synthetic-data-go-key');
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => start,
      createCoordinationToken: () => 'coordination-maritime-failure',
      createRequestId: () => 'request-maritime-failure',
      environment: { DATA_GO_KR_SERVICE_KEY: 'synthetic-data-go-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => start),
      logWriter: (line) => logs.push(line),
    });

    const response = await runtime.handle(createRequest());
    const serialized = JSON.stringify([await response.json(), logs]);

    expect(response.status).toBe(502);
    expect(JSON.parse(serialized)[0]).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
    expect(serialized).not.toContain('synthetic-data-go-key');
    expect(serialized).not.toContain('raw-mtis-marker');
    expect(serialized).not.toContain('serviceKey=');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
