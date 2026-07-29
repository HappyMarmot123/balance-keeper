// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { MARKET_INDEXES, marketDataSchema } from '../../../src/entities/market/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const now = Date.parse('2026-07-28T03:00:00.000Z');

const createResponse = (input: RequestInfo | URL): Response => {
  const providerName = new URL(input instanceof URL ? input.href : String(input)).searchParams.get('idxNm');
  const definition = MARKET_INDEXES.find((candidate) => candidate.providerName === providerName);
  if (definition === undefined) {
    return new Response(null, { status: 404 });
  }
  const isKospi = definition.id === 'kospi';

  return Response.json({
    response: {
      body: {
        items: {
          item: [
            {
              basDt: '20260727',
              clpr: isKospi ? '2811.72' : '807.41',
              fltRt: isKospi ? '0.66' : '-0.39',
              idxCsf: isKospi ? 'KOSPI시리즈' : 'KOSDAQ시리즈',
              idxNm: definition.providerName,
              vs: isKospi ? '18.42' : '-3.15',
            },
          ],
        },
        numOfRows: 30,
        pageNo: 1,
        totalCount: 1,
      },
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    },
  });
};

describe('markets production route registration', () => {
  it('registers /api/markets and serves a cacheable strict delayed snapshot', async () => {
    let requestSequence = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-markets',
      createRequestId: () => `markets-runtime-${++requestSequence}`,
      environment: { DATA_GO_KR_SERVICE_KEY: 'synthetic-data-go-key' },
      fetcher: async (input) => createResponse(input),
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    expect(runtime.getCdnMaxAgeSeconds('/api/markets')).toBe(60 * 60);

    const request = withTrustedAdmissionSubject(new Request('https://balance.test/api/markets'), '203.0.113.41');
    const response = await runtime.handle(request);
    const envelope = successEnvelopeSchema(marketDataSchema).parse(await response.json());

    expect(response.status).toBe(200);
    expect(envelope.data.indices.map((index) => index.id)).toEqual(['kospi', 'kosdaq']);
    expect(envelope.meta).toMatchObject({
      cache: 'MISS',
      requestId: 'markets-runtime-1',
      source: '금융위원회 · 한국거래소 통계정보',
    });
    expect(JSON.stringify(envelope)).not.toContain('synthetic-data-go-key');
  });
});
