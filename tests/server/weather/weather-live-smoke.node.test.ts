import { describe, expect, it } from 'vitest';

import { weatherNowcastDataSchema } from '../../../src/entities/weather/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
const liveIt = serviceKey === undefined || serviceKey.length === 0 ? it.skip : it;

describe('KMA weather credential-gated live smoke', () => {
  liveIt(
    'serves one normalized Seoul observation through the production gateway',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('Canonical KMA credential is required for the live smoke');
      }

      let providerRequestCount = 0;
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-weather-live-smoke',
        createRequestId: () => 'request-weather-live-smoke',
        environment: { DATA_GO_KR_SERVICE_KEY: serviceKey },
        fetcher: async (input, init) => {
          providerRequestCount += 1;
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const request = withTrustedAdmissionSubject(
        new Request('https://balance.test/api/weather?region=seoul'),
        '203.0.113.20',
      );

      const response = await runtime.handle(request);
      expect(response.status).toBe(200);

      const envelope = successEnvelopeSchema(weatherNowcastDataSchema).parse(await response.json());
      expect(envelope.meta).toMatchObject({ cache: 'MISS', source: 'KMA' });
      expect(envelope.data === null || envelope.data.region === 'seoul').toBe(true);
      expect(providerRequestCount).toBe(1);
    },
    15_000,
  );
});
