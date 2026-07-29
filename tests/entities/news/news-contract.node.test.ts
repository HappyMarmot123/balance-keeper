// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as newsContractModule from '../../../src/entities/news/contract';

const contract = newsContractModule as Record<string, unknown>;

const availableSnapshot = {
  items: [
    {
      id: 'mois:1012:120002',
      originalUrl:
        'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=120002',
      publishedAt: Date.parse('2026-07-29T01:30:00.000Z'),
      sourceId: 'mois',
      title: '국민 안전 정책 발표',
    },
    {
      id: 'mcst:13001',
      originalUrl: 'https://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=13001',
      publishedAt: Date.parse('2026-07-29T00:00:00.000Z'),
      sourceId: 'mcst',
      title: '문화 정책 발표',
    },
  ],
  sources: [
    {
      id: 'mcst',
      label: '문화체육관광부',
      license: 'KOGL-1',
      status: 'available',
    },
    {
      id: 'mois',
      label: '행정안전부',
      license: 'KOGL-1',
      status: 'available',
    },
  ],
} as const;

describe('public press news contract', () => {
  it('exports the two approved KOGL-1 sources and a strict snapshot schema', () => {
    expect(contract.PUBLIC_PRESS_SOURCES).toEqual([
      { id: 'mcst', label: '문화체육관광부', license: 'KOGL-1' },
      { id: 'mois', label: '행정안전부', license: 'KOGL-1' },
    ]);
    expect(contract.newsDataSchema).toBeTypeOf('object');

    const schema = contract.newsDataSchema as
      | { parse(input: unknown): { items: readonly unknown[]; sources: readonly unknown[] } }
      | undefined;
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(availableSnapshot)).toEqual(availableSnapshot);
    expect(() =>
      schema.parse({
        ...availableSnapshot,
        body: 'provider text must never cross the boundary',
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...availableSnapshot,
        items: [{ ...availableSnapshot.items[0], summary: 'not allowed' }],
      }),
    ).toThrow();
  });

  it('rejects non-HTTPS links, duplicates, unsorted items and more than twelve headlines', () => {
    const schema = contract.newsDataSchema as { parse(input: unknown): unknown } | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() =>
      schema.parse({
        ...availableSnapshot,
        items: [{ ...availableSnapshot.items[0], originalUrl: 'http://www.mois.go.kr/article' }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...availableSnapshot,
        items: [availableSnapshot.items[0], availableSnapshot.items[0]],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...availableSnapshot,
        items: [...availableSnapshot.items].reverse(),
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...availableSnapshot,
        items: Array.from({ length: 13 }, (_, index) => ({
          ...availableSnapshot.items[0],
          id: `mois:1012:${index}`,
          originalUrl: `https://www.mois.go.kr/article/${index}`,
          publishedAt: availableSnapshot.items[0].publishedAt - index,
        })),
      }),
    ).toThrow();
  });

  it('keeps source status consistent with its items and requires one usable source', () => {
    const schema = contract.newsDataSchema as { parse(input: unknown): unknown } | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(
      schema.parse({
        items: availableSnapshot.items.slice(0, 1),
        sources: [{ ...availableSnapshot.sources[0], status: 'unavailable' }, availableSnapshot.sources[1]],
      }),
    ).toBeTruthy();
    expect(() =>
      schema.parse({
        items: availableSnapshot.items,
        sources: [{ ...availableSnapshot.sources[0], status: 'empty' }, availableSnapshot.sources[1]],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        items: [],
        sources: availableSnapshot.sources.map((source) => ({ ...source, status: 'unavailable' })),
      }),
    ).toThrow();
  });
});
