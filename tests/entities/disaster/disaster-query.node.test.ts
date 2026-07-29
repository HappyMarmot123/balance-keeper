// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as disasterModule from '../../../src/entities/disaster';

const disaster = disasterModule as Record<string, unknown>;

describe('disaster alert query options', () => {
  it('polls the fixed gateway every minute while leaving origin freshness to the gateway', async () => {
    const queryOptions = disaster.disasterQueryOptions as
      | ((dependencies?: { fetcher?: typeof fetch }) => {
          queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
          queryKey: readonly unknown[];
        })
      | undefined;
    const profile = disaster.DISASTER_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(queryOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      staleTime: 60_000,
    });
    if (queryOptions === undefined) {
      return;
    }

    const envelope = {
      data: {
        alerts: [
          {
            disasterType: '호우',
            emergencyStep: '긴급재난',
            id: '9003',
            issuedAt: Date.parse('2026-07-29T07:30:00.000Z'),
            message: '하천 범람 위험이 있으니 안전한 곳으로 대피하십시오.',
            regionText: '서울특별시 전체',
          },
        ],
      },
      meta: {
        cache: 'MISS',
        fetchedAt: Date.parse('2026-07-29T08:00:00.000Z'),
        requestId: 'disaster-query',
        source: '행정안전부',
      },
    };
    const fetcher = vi.fn(async () => Response.json(envelope));
    const options = queryOptions({ fetcher });
    const signal = new AbortController().signal;

    expect(options.queryKey).toEqual(['disaster-alerts']);
    await expect(options.queryFn({ signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/disaster',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal }),
    );
  });
});
