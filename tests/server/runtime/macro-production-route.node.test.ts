// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { MACRO_SERIES, macroDataSchema } from '../../../src/entities/macro/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const now = Date.parse('2026-07-28T03:00:00.000Z');

const createResponse = (input: RequestInfo | URL): Response => {
  const pathname = new URL(input instanceof URL ? input.href : String(input)).pathname;
  const series = MACRO_SERIES.find((candidate) => pathname.includes(`/${candidate.statCode}/`));
  if (series === undefined) {
    return new Response(null, { status: 404 });
  }
  const [value, period] =
    series.id === 'usd-krw'
      ? ['1382.4', '20260728']
      : series.id === 'base-rate'
        ? ['2.5', '20260728']
        : ['418300000', '202606'];

  return Response.json({
    StatisticSearch: {
      list_total_count: 1,
      row: [
        {
          DATA_VALUE: value,
          ITEM_CODE1: series.itemCode,
          ITEM_CODE2: null,
          ITEM_CODE3: null,
          ITEM_CODE4: null,
          ITEM_NAME1: series.label,
          ITEM_NAME2: null,
          ITEM_NAME3: null,
          ITEM_NAME4: null,
          STAT_CODE: series.statCode,
          STAT_NAME: `Synthetic ${series.label}`,
          TIME: period,
          UNIT_NAME: series.sourceUnit,
          WGT: null,
        },
      ],
    },
  });
};

describe('macro production route registration', () => {
  it('registers /api/macro and serves a cacheable strict snapshot', async () => {
    let requestSequence = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-macro',
      createRequestId: () => `macro-runtime-${++requestSequence}`,
      environment: { ECOS_API_KEY: 'synthetic-ecos-key' },
      fetcher: async (input) => createResponse(input),
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    expect(runtime.getCdnMaxAgeSeconds('/api/macro')).toBe(60 * 60);

    const request = withTrustedAdmissionSubject(new Request('https://balance.test/api/macro'), '203.0.113.40');
    const response = await runtime.handle(request);
    const envelope = successEnvelopeSchema(macroDataSchema).parse(await response.json());

    expect(response.status).toBe(200);
    expect(envelope.data.series.map((series) => series.id)).toEqual(['usd-krw', 'base-rate', 'fx-reserves']);
    expect(envelope.meta).toMatchObject({
      cache: 'MISS',
      requestId: 'macro-runtime-1',
      source: 'ECOS',
    });
    expect(JSON.stringify(envelope)).not.toContain('synthetic-ecos-key');
  });
});
