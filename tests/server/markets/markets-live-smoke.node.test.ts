// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { marketDataSchema } from '../../../src/entities/market/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.KOREA_MARKET_INDEX_KEY?.trim();
const liveIt = serviceKey === undefined || serviceKey.length === 0 ? it.skip : it;

describe('Financial Services Commission market credential-gated live smoke', () => {
  liveIt(
    'serves two strict delayed domestic indices through the production gateway',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('KOREA_MARKET_INDEX_KEY is required for the live smoke');
      }

      let providerRequestCount = 0;
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-markets-live-smoke',
        createRequestId: () => 'request-markets-live-smoke',
        environment: { KOREA_MARKET_INDEX_KEY: serviceKey },
        fetcher: async (input, init) => {
          providerRequestCount += 1;
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const request = withTrustedAdmissionSubject(new Request('https://balance.test/api/markets'), '203.0.113.42');

      const response = await runtime.handle(request);
      expect(response.status).toBe(200);

      const envelope = successEnvelopeSchema(marketDataSchema).parse(await response.json());
      expect(envelope.meta).toMatchObject({
        cache: 'MISS',
        source: '금융위원회 · 한국거래소 통계정보',
      });
      expect(envelope.data.indices.map((index) => index.id)).toEqual(['kospi', 'kosdaq']);
      expect(
        envelope.data.indices.map((index) => ({
          date: index.observation?.date,
          id: index.id,
          status: index.status,
        })),
      ).toEqual([
        { date: expect.stringMatching(/^\d{8}$/), id: 'kospi', status: 'available' },
        { date: expect.stringMatching(/^\d{8}$/), id: 'kosdaq', status: 'available' },
      ]);
      expect(
        envelope.data.indices.every(
          (index) =>
            index.observation !== null &&
            Number.isFinite(index.observation.close) &&
            Number.isFinite(index.observation.change) &&
            Number.isFinite(index.observation.changePercent),
        ),
      ).toBe(true);
      expect(providerRequestCount).toBe(2);
    },
    20_000,
  );
});
