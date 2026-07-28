// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { macroDataSchema } from '../../../src/entities/macro/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.ECOS_API_KEY?.trim();
const liveIt = serviceKey === undefined || serviceKey.length === 0 ? it.skip : it;

describe('ECOS credential-gated live smoke', () => {
  liveIt(
    'serves the three discovered macro series through the production gateway',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('ECOS_API_KEY is required for the live smoke');
      }

      let providerRequestCount = 0;
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-macro-live-smoke',
        createRequestId: () => 'request-macro-live-smoke',
        environment: { ECOS_API_KEY: serviceKey },
        fetcher: async (input, init) => {
          providerRequestCount += 1;
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const request = withTrustedAdmissionSubject(new Request('https://balance.test/api/macro'), '203.0.113.41');

      const response = await runtime.handle(request);
      expect(response.status).toBe(200);

      const envelope = successEnvelopeSchema(macroDataSchema).parse(await response.json());
      expect(envelope.meta).toMatchObject({ cache: 'MISS', source: 'ECOS' });
      expect(envelope.data.series.map((series) => series.id)).toEqual(['usd-krw', 'base-rate', 'fx-reserves']);
      expect(envelope.data.series.every((series) => series.status !== 'unavailable')).toBe(true);
      expect(providerRequestCount).toBe(3);
    },
    20_000,
  );
});
