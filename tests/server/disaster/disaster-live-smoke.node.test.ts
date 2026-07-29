// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { disasterDataSchema } from '../../../src/entities/disaster/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.SAFETY_DATA_SERVICE_KEY?.trim();
const liveIt = serviceKey === undefined || serviceKey.length === 0 ? it.skip : it;

describe('Safetydata disaster credential-gated live smoke', () => {
  liveIt(
    'serves and revalidates one strict recent snapshot through the production gateway',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('SAFETY_DATA_SERVICE_KEY is required for the live smoke');
      }

      let providerRequestCount = 0;
      let requestSequence = 0;
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-disaster-live-smoke',
        createRequestId: () => `request-disaster-live-smoke-${++requestSequence}`,
        environment: { SAFETY_DATA_SERVICE_KEY: serviceKey },
        fetcher: async (input, init) => {
          providerRequestCount += 1;
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const createRequest = (headers?: HeadersInit) =>
        withTrustedAdmissionSubject(
          new Request('https://balance.test/api/disaster', headers === undefined ? undefined : { headers }),
          '203.0.113.45',
        );

      const missResponse = await runtime.handle(createRequest());
      expect(missResponse.status).toBe(200);
      const etag = missResponse.headers.get('etag');
      expect(etag).not.toBeNull();

      const missEnvelope = successEnvelopeSchema(disasterDataSchema).parse(await missResponse.json());
      expect(missEnvelope.meta).toMatchObject({
        cache: 'MISS',
        source: '행정안전부 · 재난안전데이터공유플랫폼 · 공공누리 제4유형 기준',
      });
      expect(missEnvelope.data.alerts.length).toBeLessThanOrEqual(50);
      expect(providerRequestCount).toBeGreaterThanOrEqual(1);
      expect(providerRequestCount).toBeLessThanOrEqual(2);

      const providerRequestsAfterMiss = providerRequestCount;
      const hitResponse = await runtime.handle(createRequest());
      const hitEnvelope = successEnvelopeSchema(disasterDataSchema).parse(await hitResponse.json());
      expect(hitEnvelope.meta.cache).toBe('HIT');
      expect(hitEnvelope.data).toEqual(missEnvelope.data);
      expect(providerRequestCount).toBe(providerRequestsAfterMiss);

      const revalidatedResponse = await runtime.handle(
        createRequest({ 'If-None-Match': etag?.replace('W/', '') ?? '' }),
      );
      expect(revalidatedResponse.status).toBe(304);
      expect(await revalidatedResponse.text()).toBe('');
      expect(providerRequestCount).toBe(providerRequestsAfterMiss);
    },
    20_000,
  );
});
