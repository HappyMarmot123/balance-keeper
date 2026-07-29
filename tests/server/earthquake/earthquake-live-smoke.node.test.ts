// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { earthquakeDataSchema } from '../../../src/entities/earthquake/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
const liveIt = serviceKey === undefined || serviceKey.length === 0 ? it.skip : it;

describe('KMA and USGS credential-gated live smoke', () => {
  liveIt(
    'serves one strict recent regional snapshot through the production gateway',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('DATA_GO_KR_SERVICE_KEY is required for the live smoke');
      }

      let providerRequestCount = 0;
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-earthquake-live-smoke',
        createRequestId: () => 'request-earthquake-live-smoke',
        environment: { DATA_GO_KR_SERVICE_KEY: serviceKey },
        fetcher: async (input, init) => {
          providerRequestCount += 1;
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const request = withTrustedAdmissionSubject(new Request('https://balance.test/api/earthquake'), '203.0.113.33');

      const response = await runtime.handle(request);
      expect(response.status).toBe(200);

      const envelope = successEnvelopeSchema(earthquakeDataSchema).parse(await response.json());
      expect(envelope.meta).toMatchObject({
        cache: 'MISS',
        source: 'KMA+USGS',
      });
      expect(envelope.data.sources).toMatchObject({
        kma: { status: 'available' },
        usgs: { status: 'available' },
      });
      expect(envelope.data.window.to - envelope.data.window.from).toBe(7 * 24 * 60 * 60_000);
      expect(envelope.data.sources.kma.to - envelope.data.sources.kma.from).toBe(3 * 24 * 60 * 60_000);
      expect(providerRequestCount).toBeGreaterThanOrEqual(2);
    },
    20_000,
  );
});
