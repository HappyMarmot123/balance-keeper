// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { newsDataSchema } from '../../../src/entities/news/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const now = Date.parse('2026-07-29T05:00:00.000Z');

const createFeed = (source: 'mcst' | 'mois') => {
  const link =
    source === 'mcst'
      ? 'http://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=13001'
      : 'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=120002';
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Press</title><item><title>${source} 정책 발표</title><link>${link.replaceAll('&', '&amp;')}</link><pubDate>WED, 29 JUL 2026 13:00:00 KST</pubDate><description>discard me</description></item></channel></rss>`;
};

describe('public press news production route registration', () => {
  it('registers /api/news without credentials and serves a strict cacheable snapshot', async () => {
    let requestSequence = 0;
    let providerRequests = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-news',
      createRequestId: () => `news-runtime-${++requestSequence}`,
      environment: {},
      fetcher: async (input) => {
        providerRequests += 1;
        const url = new URL(input instanceof URL ? input.href : String(input));
        const source = url.hostname.includes('mcst') ? 'mcst' : 'mois';
        return new Response(createFeed(source), { headers: { 'content-type': 'text/xml;charset=utf-8' } });
      },
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    expect(runtime.getCdnMaxAgeSeconds('/api/news')).toBe(5 * 60);

    const response = await runtime.handle(
      withTrustedAdmissionSubject(new Request('https://balance.test/api/news'), '203.0.113.42'),
    );
    const envelope = successEnvelopeSchema(newsDataSchema).parse(await response.json());

    expect(response.status).toBe(200);
    expect(providerRequests).toBe(2);
    expect(envelope.data.sources.map((source) => source.id)).toEqual(['mcst', 'mois']);
    expect(envelope.data.items).toHaveLength(2);
    expect(envelope.meta).toMatchObject({
      cache: 'MISS',
      requestId: 'news-runtime-1',
      source: '문화체육관광부 · 행정안전부 · 공공누리 제1유형',
    });
    expect(JSON.stringify(envelope)).not.toContain('discard me');
  });
});
