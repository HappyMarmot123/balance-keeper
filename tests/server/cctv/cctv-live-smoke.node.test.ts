// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { cctvDataSchema } from '../../../src/entities/cctv/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.ITS_API_KEY?.trim();
const liveIt = serviceKey === undefined || serviceKey.length === 0 ? it.skip : it;

describe('ITS CCTV credential-gated live smoke', () => {
  liveIt(
    'serves and caches one strict atomic metadata snapshot through the production gateway',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('ITS_API_KEY is required for the live smoke');
      }

      let providerRequestCount = 0;
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-cctv-live-smoke',
        createRequestId: () => 'request-cctv-live-smoke',
        environment: { ITS_API_KEY: serviceKey },
        fetcher: async (input, init) => {
          providerRequestCount += 1;
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const createRequest = () =>
        withTrustedAdmissionSubject(
          new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38'),
          '203.0.113.94',
        );

      const missResponse = await runtime.handle(createRequest());
      expect(missResponse.status).toBe(200);
      const missEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await missResponse.json());
      expect(missEnvelope.meta).toMatchObject({
        cache: 'MISS',
        source: 'ITS 국가교통정보센터',
      });
      expect(missEnvelope.data.cameras.length).toBeGreaterThan(0);
      expect(providerRequestCount).toBe(4);

      const hitResponse = await runtime.handle(createRequest());
      const hitEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await hitResponse.json());
      expect(hitEnvelope.meta.cache).toBe('HIT');
      expect(hitEnvelope.data).toEqual(missEnvelope.data);
      expect(providerRequestCount).toBe(4);
    },
    20_000,
  );
});
