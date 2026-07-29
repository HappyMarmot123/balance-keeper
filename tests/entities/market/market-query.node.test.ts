// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as marketModule from '../../../src/entities/market';

const market = marketModule as Record<string, unknown>;
const snapshot = {
  indices: [
    {
      displayUnit: 'pt',
      id: 'kospi',
      label: 'KOSPI',
      observation: { change: 18.42, changePercent: 0.66, close: 2811.72, date: '20260727' },
      providerName: '코스피',
      status: 'available',
    },
    {
      displayUnit: 'pt',
      id: 'kosdaq',
      label: 'KOSDAQ',
      observation: { change: -3.15, changePercent: -0.39, close: 807.41, date: '20260727' },
      providerName: '코스닥',
      status: 'available',
    },
  ],
} as const;

describe('market query options', () => {
  it('uses one fixed gateway path and a cadence suitable for next-business-day closes', async () => {
    const queryOptions = market.marketQueryOptions as
      | ((dependencies?: { fetcher?: typeof fetch }) => {
          queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
          queryKey: readonly unknown[];
        })
      | undefined;
    const profile = market.MARKET_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(queryOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 6 * 60 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 3 * 60 * 60_000,
    });
    if (queryOptions === undefined) {
      return;
    }

    const envelope = {
      data: snapshot,
      meta: {
        cache: 'MISS',
        fetchedAt: Date.parse('2026-07-28T03:00:00Z'),
        requestId: 'market-query',
        source: '금융위원회 · 한국거래소 통계정보',
      },
    };
    const fetcher = vi.fn(async () =>
      Response.json(envelope, {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const options = queryOptions({ fetcher });
    const signal = new AbortController().signal;

    expect(options.queryKey).toEqual(['markets']);
    await expect(options.queryFn({ signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/markets',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal }),
    );
  });
});
