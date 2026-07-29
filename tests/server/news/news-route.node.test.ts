// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { newsDataSchema } from '../../../src/entities/news/contract';
import { createAdmissionSubject } from '../../../src/server/gateway';
import type { createNewsRoute } from '../../../src/server/routes/news';
import * as newsRouteModule from '../../../src/server/routes/news';

const routeModule = newsRouteModule as Record<string, unknown>;
const now = Date.parse('2026-07-29T05:00:00.000Z');

const rss = (items: readonly { date: string; link: string; title: string }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Public press</title>
${items
  .map(
    (item) =>
      `<item><title><![CDATA[${item.title}]]></title><link>${item.link.replaceAll('&', '&amp;')}</link><pubDate>${item.date}</pubDate><description><![CDATA[provider body must be discarded]]></description></item>`,
  )
  .join('')}
</channel></rss>`;

const mcstItem = {
  date: 'Wed, 29 Jul 2026 13:00:00 KST',
  link: 'http://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=13001',
  title: '문화 정책 발표',
};
const moisItem = {
  date: 'WED, 29 JUL 2026 13:30:00 KST',
  link: 'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=120002',
  title: '국민 안전 정책 발표',
};

const createFetcher = (failedSource?: 'mcst' | 'mois') =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    const sourceId = url.hostname.includes('mcst') ? 'mcst' : 'mois';
    if (sourceId === failedSource) {
      return new Response(null, { status: 503 });
    }
    return new Response(rss(sourceId === 'mcst' ? [mcstItem] : [moisItem]), {
      headers: { 'content-type': 'text/xml;charset=utf-8' },
    });
  });

const createRoute = (overrides: Record<string, unknown> = {}) => {
  const factory = routeModule.createNewsRoute as
    | ((options: Record<string, unknown>) => ReturnType<typeof createNewsRoute>)
    | undefined;
  expect(factory).toBeTypeOf('function');
  if (factory === undefined) {
    throw new TypeError('createNewsRoute is missing');
  }
  return factory({
    clock: () => now,
    fetcher: createFetcher(),
    readAdmissionSubject: () => createAdmissionSubject('news-test'),
    ...overrides,
  });
};

describe('public press news gateway route', () => {
  it('uses a fixed queryless identity and a ten-minute public-feed profile', () => {
    const route = createRoute();

    expect(route.path).toBe('/api/news');
    expect(route.parseRequest(new Request('https://balance.test/api/news'))).toEqual({
      admissionSubject: createAdmissionSubject('news-test'),
      input: {},
      publicCacheIdentity: { scope: 'korea-public-press' },
    });
    expect(() => route.parseRequest(new Request('https://balance.test/api/news?category=general'))).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
    expect(route.profile).toMatchObject({
      cdnMaxAgeSeconds: 5 * 60,
      freshForMs: 10 * 60_000,
      negativeForMs: 5 * 60_000,
      staleIfErrorForMs: 6 * 60 * 60_000,
      upstreamTimeoutMs: 8_000,
    });
  });

  it('merges two KOGL sources in newest-first order without provider body fields', async () => {
    const result = await createRoute().load({}, new AbortController().signal);

    expect(result).toMatchObject({
      kind: 'value',
      fetchedAt: now,
      source: '문화체육관광부 · 행정안전부 · 공공누리 제1유형',
      data: {
        items: [
          { sourceId: 'mois', title: moisItem.title },
          { sourceId: 'mcst', title: mcstItem.title },
        ],
        sources: [
          { id: 'mcst', status: 'available' },
          { id: 'mois', status: 'available' },
        ],
      },
    });
    const data = newsDataSchema.parse(result.data);
    expect(data).not.toHaveProperty('description');
    expect(data.items.every((item) => !('description' in item) && !('body' in item))).toBe(true);
  });

  it('keeps one successful source and marks the failed source unavailable', async () => {
    const result = await createRoute({ fetcher: createFetcher('mois') }).load({}, new AbortController().signal);

    expect(result).toMatchObject({
      kind: 'value',
      data: {
        items: [{ sourceId: 'mcst' }],
        sources: [
          { id: 'mcst', status: 'available' },
          { id: 'mois', status: 'unavailable' },
        ],
      },
    });
  });

  it('negative-caches only a fully successful empty result and fails when both feeds fail', async () => {
    const emptyRoute = createRoute({
      fetcher: vi.fn(async () => new Response(rss([]), { headers: { 'content-type': 'text/xml' } })),
    });
    await expect(emptyRoute.load({}, new AbortController().signal)).resolves.toMatchObject({
      kind: 'empty',
      data: {
        items: [],
        sources: [{ status: 'empty' }, { status: 'empty' }],
      },
    });

    const failedRoute = createRoute({ fetcher: vi.fn(async () => new Response(null, { status: 503 })) });
    await expect(failedRoute.load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('keeps a successful source available when the global twelve-item cap excludes its older item', async () => {
    const newerMoisItems = Array.from({ length: 12 }, (_, index) => ({
      date: `Wed, 29 Jul 2026 13:${String(59 - index).padStart(2, '0')}:00 KST`,
      link:
        'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do' +
        `?bbsId=BBSMSTR_000000000008&nttId=${120_100 + index}`,
      title: `국민 안전 정책 ${index}`,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof URL ? input.href : String(input));
      const items = url.hostname.includes('mcst') ? [mcstItem] : newerMoisItems;
      return new Response(rss(items), { headers: { 'content-type': 'text/xml;charset=utf-8' } });
    });

    const result = await createRoute({ fetcher }).load({}, new AbortController().signal);
    const data = newsDataSchema.parse(result.data);

    expect(data.items).toHaveLength(12);
    expect(data.items.every((item) => item.sourceId === 'mois')).toBe(true);
    expect(data.sources).toMatchObject([
      { id: 'mcst', status: 'available' },
      { id: 'mois', status: 'available' },
    ]);
  });

  it('times out one feed independently so the other feed can still succeed', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input.href : String(input));
      if (url.hostname.includes('mois')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      }
      return Promise.resolve(new Response(rss([mcstItem]), { headers: { 'content-type': 'text/xml' } }));
    });

    await expect(
      createRoute({ feedTimeoutMs: 5, fetcher }).load({}, new AbortController().signal),
    ).resolves.toMatchObject({
      data: {
        sources: [
          { id: 'mcst', status: 'available' },
          { id: 'mois', status: 'unavailable' },
        ],
      },
    });
  });
});
