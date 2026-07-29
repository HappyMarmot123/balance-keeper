// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as newsModule from '../../../src/entities/news';

const news = newsModule as Record<string, unknown>;

const snapshot = {
  items: [
    {
      id: 'mois:BBSMSTR_000000000008:120002',
      originalUrl:
        'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=120002',
      publishedAt: Date.parse('2026-07-29T01:30:00.000Z'),
      sourceId: 'mois',
      title: '국민 안전 정책 발표',
    },
  ],
  sources: [
    {
      id: 'mcst',
      label: '문화체육관광부',
      license: 'KOGL-1',
      status: 'empty',
    },
    {
      id: 'mois',
      label: '행정안전부',
      license: 'KOGL-1',
      status: 'available',
    },
  ],
} as const;

describe('news query options', () => {
  it('uses the fixed news gateway and the approved five-minute polling cadence', async () => {
    const queryOptions = news.newsQueryOptions as
      | ((dependencies?: { fetcher?: typeof fetch }) => {
          queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
          queryKey: readonly unknown[];
        })
      | undefined;
    const profile = news.NEWS_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(queryOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 5 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 2 * 60_000,
    });
    if (queryOptions === undefined) {
      return;
    }

    const envelope = {
      data: snapshot,
      meta: {
        cache: 'MISS',
        fetchedAt: Date.parse('2026-07-29T03:00:00.000Z'),
        requestId: 'news-query',
        source: 'MCST+MOIS',
      },
    };
    const fetcher = vi.fn(async () =>
      Response.json(envelope, {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const options = queryOptions({ fetcher });
    const signal = new AbortController().signal;

    expect(options.queryKey).toEqual(['news']);
    await expect(options.queryFn({ signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/news',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal }),
    );
  });
});
