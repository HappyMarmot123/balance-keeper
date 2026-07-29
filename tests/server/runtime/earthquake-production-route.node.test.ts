// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { earthquakeDataSchema } from '../../../src/entities/earthquake/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const kmaFixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../fixtures/kma/earthquake-success.json'), 'utf8'),
) as unknown;
const usgsFixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../fixtures/usgs/earthquake-success.json'), 'utf8'),
) as unknown;

const createProviderResponse = (input: RequestInfo | URL): Response => {
  const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
  return Response.json(url.hostname === 'apis.data.go.kr' ? kmaFixture : usgsFixture);
};

describe('earthquake production route registration', () => {
  it('registers /api/earthquake beside weather and air with its own CDN profile', () => {
    const runtime = createProductionGatewayRuntime({ environment: {}, logWriter: () => undefined });

    expect(runtime.getCdnMaxAgeSeconds('/api/earthquake')).toBe(30);
    expect(runtime.getCdnMaxAgeSeconds('/api/weather')).toBe(5 * 60);
    expect(runtime.getCdnMaxAgeSeconds('/api/air')).toBe(15 * 60);
  });

  it('serves a strict MISS then HIT without repeating either provider request', async () => {
    const now = Date.parse('2026-07-28T03:00:00.000Z');
    let requestSequence = 0;
    let providerRequestCount = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-earthquake-runtime',
      createRequestId: () => `request-earthquake-${++requestSequence}`,
      environment: { DATA_GO_KR_SERVICE_KEY: 'synthetic-data-go-key' },
      fetcher: async (input) => {
        providerRequestCount += 1;
        return createProviderResponse(input);
      },
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = () =>
      withTrustedAdmissionSubject(new Request('https://balance.test/api/earthquake'), '203.0.113.30');

    const missResponse = await runtime.handle(request());
    const missEnvelope = successEnvelopeSchema(earthquakeDataSchema).parse(await missResponse.json());
    const hitResponse = await runtime.handle(request());
    const hitEnvelope = successEnvelopeSchema(earthquakeDataSchema).parse(await hitResponse.json());

    expect(missEnvelope).toMatchObject({
      data: {
        events: [{ id: 'kma:108:202607:42' }, { id: 'usgs:us-test-2' }],
        sources: {
          kma: { status: 'available' },
          usgs: { status: 'available' },
        },
      },
      meta: { cache: 'MISS', requestId: 'request-earthquake-1', source: 'KMA+USGS' },
    });
    expect(hitEnvelope.meta).toMatchObject({ cache: 'HIT', requestId: 'request-earthquake-2' });
    expect(providerRequestCount).toBe(2);
    expect(JSON.stringify([missEnvelope, hitEnvelope])).not.toContain('synthetic-data-go-key');
  });

  it('serves aggregate STALE only after both providers fail beyond freshness', async () => {
    let now = Date.parse('2026-07-28T03:00:00.000Z');
    let failProviders = false;
    let requestSequence = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-earthquake-${requestSequence}`,
      createRequestId: () => `request-earthquake-stale-${++requestSequence}`,
      environment: { DATA_GO_KR_SERVICE_KEY: 'synthetic-data-go-key' },
      fetcher: async (input) => (failProviders ? new Response(null, { status: 503 }) : createProviderResponse(input)),
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = () =>
      withTrustedAdmissionSubject(new Request('https://balance.test/api/earthquake'), '203.0.113.31');

    const missEnvelope = successEnvelopeSchema(earthquakeDataSchema).parse(
      await (await runtime.handle(request())).json(),
    );
    failProviders = true;
    now += 60_001;
    const staleResponse = await runtime.handle(request());
    const staleEnvelope = successEnvelopeSchema(earthquakeDataSchema).parse(await staleResponse.json());

    expect(staleEnvelope.data).toEqual(missEnvelope.data);
    expect(staleEnvelope.meta).toMatchObject({
      cache: 'STALE',
      fetchedAt: missEnvelope.meta.fetchedAt,
      requestId: 'request-earthquake-stale-2',
      source: 'KMA+USGS',
    });
  });

  it('remains useful without KMA configuration by exposing USGS partial coverage', async () => {
    const now = Date.parse('2026-07-28T03:00:00.000Z');
    let providerRequestCount = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-earthquake-partial',
      createRequestId: () => 'request-earthquake-partial',
      environment: {},
      fetcher: async (input) => {
        providerRequestCount += 1;
        return createProviderResponse(input);
      },
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = withTrustedAdmissionSubject(new Request('https://balance.test/api/earthquake'), '203.0.113.32');

    const response = await runtime.handle(request);
    const envelope = successEnvelopeSchema(earthquakeDataSchema).parse(await response.json());

    expect(envelope.data.sources).toMatchObject({
      kma: { status: 'missing-credential' },
      usgs: { status: 'available' },
    });
    expect(envelope.meta.source).toBe('USGS');
    expect(providerRequestCount).toBe(1);
  });
});
