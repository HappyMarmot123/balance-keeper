// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { airQualityDataSchema } from '../../../src/entities/air-quality/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const environment = {
  DATA_GO_KR_SERVICE_KEY: process.env.DATA_GO_KR_SERVICE_KEY?.trim(),
  KOREA_AIR_QUALITY_BASE_URL: process.env.KOREA_AIR_QUALITY_BASE_URL?.trim(),
  KOREA_AIR_STATION_BASE_URL: process.env.KOREA_AIR_STATION_BASE_URL?.trim(),
};
const hasLiveConfig = Object.values(environment).every((value) => value !== undefined && value.length > 0);
const liveIt = hasLiveConfig ? it : it.skip;

describe('AirKorea credential-gated live smoke', () => {
  liveIt(
    'serves one normalized Seoul snapshot through the production gateway',
    async () => {
      if (!hasLiveConfig) {
        throw new TypeError('Canonical AirKorea measurement and station configuration is required for the live smoke');
      }

      let providerRequestCount = 0;
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-air-live-smoke',
        createRequestId: () => 'request-air-live-smoke',
        environment,
        fetcher: async (input, init) => {
          providerRequestCount += 1;
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const request = withTrustedAdmissionSubject(
        new Request('https://balance.test/api/air?region=seoul'),
        '203.0.113.21',
      );

      const response = await runtime.handle(request);
      expect(response.status).toBe(200);

      const envelope = successEnvelopeSchema(airQualityDataSchema).parse(await response.json());
      expect(envelope.meta).toMatchObject({
        cache: 'MISS',
        source: 'AirKorea',
      });
      expect(envelope.data === null || envelope.data.region === 'seoul').toBe(true);
      expect(providerRequestCount).toBe(2);
    },
    20_000,
  );
});
