// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { NewsItem } from '../../../src/entities/news';
import * as publicPressModule from '../../../src/server/providers/public-press';

type FeedDefinition = Readonly<{ id: 'mcst' | 'mois'; url: string }>;
type FetchFeed = (options: {
  definition: FeedDefinition;
  fetcher: typeof fetch;
  signal: AbortSignal;
}) => Promise<{ items: NewsItem[] }>;

const provider = publicPressModule as Record<string, unknown>;
const fixtures = {
  mcst: readFileSync(resolve(import.meta.dirname, '../../fixtures/news/mcst-success.xml'), 'utf8'),
  mois: readFileSync(resolve(import.meta.dirname, '../../fixtures/news/mois-success.xml'), 'utf8'),
};

const getContract = (): { definitions: readonly FeedDefinition[]; fetchFeed: FetchFeed } => {
  expect(provider.PUBLIC_PRESS_FEEDS).toBeInstanceOf(Array);
  expect(provider.fetchPublicPressFeed).toBeTypeOf('function');
  return {
    definitions: provider.PUBLIC_PRESS_FEEDS as readonly FeedDefinition[],
    fetchFeed: provider.fetchPublicPressFeed as FetchFeed,
  };
};

const xmlResponse = (body: string, headers: HeadersInit = { 'content-type': 'text/xml; charset=utf-8' }) =>
  new Response(body, { headers, status: 200 });

describe('public press feed definitions', () => {
  it('pins the two official HTTPS RSS feeds in deterministic source order', () => {
    const { definitions } = getContract();

    expect(definitions).toEqual([
      { id: 'mcst', url: 'https://www.mcst.go.kr/common/rss/press.jsp' },
      { id: 'mois', url: 'https://www.mois.go.kr/gpms/view/jsp/rss/rss.jsp?ctxCd=1012' },
    ]);
    expect(Object.isFrozen(definitions)).toBe(true);
    expect(definitions.every(Object.isFrozen)).toBe(true);
  });
});

describe('public press RSS normalization', () => {
  it('uses the exact MCST boundary, canonicalizes its same-host HTTP links and returns newest-first metadata only', async () => {
    const { definitions, fetchFeed } = getContract();
    const controller = new AbortController();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(definitions[0]?.url);
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', signal: controller.signal });
      return xmlResponse(fixtures.mcst);
    });

    const result = await fetchFeed({
      definition: definitions[0] as FeedDefinition,
      fetcher,
      signal: controller.signal,
    });

    expect(result).toEqual({
      items: [
        {
          id: 'mcst:13002',
          originalUrl: 'https://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=13002',
          publishedAt: Date.parse('2026-07-28T11:41:50+09:00'),
          sourceId: 'mcst',
          title: '문화 & 관광 최신 소식',
        },
        {
          id: 'mcst:13001',
          originalUrl: 'https://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=13001',
          publishedAt: Date.parse('2026-07-27T09:10:00+09:00'),
          sourceId: 'mcst',
          title: '먼저 등록된 오래된 소식',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/DESCRIPTION_MUST_NEVER_ESCAPE|BODY_MUST_NEVER_ESCAPE/);
  });

  it('parses case-insensitive KST dates and derives deterministic MOIS ids from the exact article key', async () => {
    const { definitions, fetchFeed } = getContract();

    await expect(
      fetchFeed({
        definition: definitions[1] as FeedDefinition,
        fetcher: async () => xmlResponse(fixtures.mois),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'mois:1012:120002',
          originalUrl:
            'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=120002',
          publishedAt: Date.parse('2026-07-29T12:00:00+09:00'),
          sourceId: 'mois',
          title: '행정안전부 최신 소식',
        },
      ],
    });
  });

  it('deduplicates repeated feed items without making the entire source unavailable', async () => {
    const { definitions, fetchFeed } = getContract();
    const repeatedItem = fixtures.mcst.match(/<item>[\s\S]*?<\/item>/u)?.[0];
    expect(repeatedItem).toBeTypeOf('string');
    const body = fixtures.mcst.replace('</channel>', `${repeatedItem ?? ''}</channel>`);

    const result = await fetchFeed({
      definition: definitions[0] as FeedDefinition,
      fetcher: async () => xmlResponse(body),
      signal: new AbortController().signal,
    });

    expect(result.items.map((item) => item.id)).toEqual(['mcst:13002', 'mcst:13001']);
  });

  it('ignores document-type text inside discarded description CDATA while rejecting a real declaration', async () => {
    const { definitions, fetchFeed } = getContract();
    const run = (body: string) =>
      fetchFeed({
        definition: definitions[0] as FeedDefinition,
        fetcher: async () => xmlResponse(body),
        signal: new AbortController().signal,
      });
    const harmlessDescription = fixtures.mcst.replace(
      'BODY_MUST_NEVER_ESCAPE',
      'article mentions <!DOCTYPE html> syntax',
    );
    const declaredDocumentType = fixtures.mcst.replace(
      '<rss version="2.0">',
      '<!DOCTYPE rss [<!ENTITY xxe "not allowed">]><rss version="2.0">',
    );

    await expect(run(harmlessDescription)).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(run(declaredDocumentType)).rejects.toThrow(/document type/i);
  });

  it.each([
    ['wrong root', fixtures.mcst.replace('<rss version="2.0">', '<feed version="2.0">').replace('</rss>', '</feed>')],
    ['wrong RSS version', fixtures.mcst.replace('version="2.0"', 'version="1.0"')],
    ['malformed XML', fixtures.mcst.replace('</item>', '')],
    ['non-KST date', fixtures.mcst.replace('Mon, 27 Jul 2026 09:10:00 KST', 'Mon, 27 Jul 2026 00:10:00 GMT')],
    ['wrong weekday', fixtures.mcst.replace('Mon, 27 Jul 2026 09:10:00 KST', 'Tue, 27 Jul 2026 09:10:00 KST')],
  ])('rejects %s as an invalid strict RSS 2.0 feed', async (_label, body) => {
    const { definitions, fetchFeed } = getContract();

    await expect(
      fetchFeed({
        definition: definitions[0] as FeedDefinition,
        fetcher: async () => xmlResponse(body),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/RSS/i);
  });

  it.each([
    ['foreign host', 'https://evil.example/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&amp;pSeq=13001'],
    ['wrong path', 'https://www.mcst.go.kr/web/s_notice/press/other.jsp?pMenuCD=0302000000&amp;pSeq=13001'],
    [
      'extra query',
      'https://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&amp;pSeq=13001&amp;next=https://evil.example',
    ],
  ])('rejects an MCST item link with a %s', async (_label, link) => {
    const { definitions, fetchFeed } = getContract();
    const body = fixtures.mcst.replace(
      'http://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&amp;pSeq=13001',
      link,
    );

    await expect(
      fetchFeed({
        definition: definitions[0] as FeedDefinition,
        fetcher: async () => xmlResponse(body),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/link/i);
  });

  it('rejects MIME mismatch, declared and streamed oversized bodies without exposing upstream content', async () => {
    const { definitions, fetchFeed } = getContract();
    const run = (response: Response) =>
      fetchFeed({
        definition: definitions[0] as FeedDefinition,
        fetcher: async () => response,
        signal: new AbortController().signal,
      });

    await expect(run(xmlResponse(fixtures.mcst, { 'content-type': 'text/html' }))).rejects.toThrow(/content type/i);
    await expect(
      run(xmlResponse(fixtures.mcst, { 'content-length': '999999999', 'content-type': 'text/xml' })),
    ).rejects.toThrow(/size/i);
    await expect(run(xmlResponse(`<rss version="2.0">${'x'.repeat(2_200_000)}</rss>`))).rejects.toThrow(/size/i);

    let error: unknown;
    try {
      await run(new Response('RAW_UPSTREAM_BODY_MUST_NOT_ESCAPE', { status: 503 }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('RAW_UPSTREAM_BODY_MUST_NOT_ESCAPE');
  });

  it('preserves caller cancellation before and during the request', async () => {
    const { definitions, fetchFeed } = getContract();
    const before = new AbortController();
    const beforeReason = new Error('synthetic pre-abort');
    before.abort(beforeReason);
    const fetcher = vi.fn(async () => xmlResponse(fixtures.mcst));

    await expect(
      fetchFeed({ definition: definitions[0] as FeedDefinition, fetcher, signal: before.signal }),
    ).rejects.toBe(beforeReason);
    expect(fetcher).not.toHaveBeenCalled();

    const during = new AbortController();
    const duringReason = new Error('synthetic deadline');
    await expect(
      fetchFeed({
        definition: definitions[0] as FeedDefinition,
        fetcher: async (_input, init) => {
          during.abort(duringReason);
          throw init?.signal?.reason;
        },
        signal: during.signal,
      }),
    ).rejects.toBe(duringReason);
  });
});
