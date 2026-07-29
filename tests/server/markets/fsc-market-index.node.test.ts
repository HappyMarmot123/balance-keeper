// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { MARKET_INDEXES } from '../../../src/entities/market';
import * as fscModule from '../../../src/server/providers/fsc';

const fsc = fscModule as Record<string, unknown>;
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/fsc/market-index-success.json'), 'utf8'),
) as Record<string, unknown>;
const now = Date.parse('2026-07-28T03:00:00.000Z');
const window = { from: '20260707', toExclusive: '20260729' } as const;

const cloneFixture = (): Record<string, unknown> => structuredClone(fixture);

const fixtureRows = (input: Record<string, unknown>): Array<Record<string, unknown>> =>
  (
    input as {
      response: { body: { items: { item: Array<Record<string, unknown>> } } };
    }
  ).response.body.items.item;

const firstFixtureRow = (input: Record<string, unknown>): Record<string, unknown> => {
  const row = fixtureRows(input)[0];
  if (row === undefined) {
    throw new TypeError('Synthetic FSC fixture must contain a row');
  }
  return row;
};

const fixtureBody = (input: Record<string, unknown>) =>
  (
    input as {
      response: {
        body: {
          items: { item: Array<Record<string, unknown>> };
          numOfRows: number;
          pageNo: number;
          totalCount: number;
        };
      };
    }
  ).response.body;

describe('Financial Services Commission market index normalization', () => {
  it('selects the latest provider date explicitly and preserves daily close semantics', () => {
    const normalize = fsc.normalizeFscMarketIndexResponse as
      | ((input: unknown, definition: (typeof MARKET_INDEXES)[number], searchWindow: typeof window) => unknown)
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    expect(normalize(fixture, MARKET_INDEXES[0], window)).toEqual({
      ...MARKET_INDEXES[0],
      observation: {
        change: 18.42,
        changePercent: 0.66,
        close: 2_811.72,
        date: '20260727',
      },
      status: 'available',
    });
  });

  it('accepts the official series classification for each requested market', () => {
    const normalize = fsc.normalizeFscMarketIndexResponse as
      | ((input: unknown, definition: (typeof MARKET_INDEXES)[number], searchWindow: typeof window) => unknown)
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    const kosdaq = cloneFixture();
    for (const row of fixtureRows(kosdaq)) {
      row.idxCsf = 'KOSDAQ시리즈';
      row.idxNm = '코스닥';
    }

    expect(normalize(kosdaq, MARKET_INDEXES[1], window)).toMatchObject({
      id: 'kosdaq',
      status: 'available',
    });
  });

  it('treats only a successful zero-row response as empty', () => {
    const normalize = fsc.normalizeFscMarketIndexResponse as
      | ((input: unknown, definition: (typeof MARKET_INDEXES)[number], searchWindow: typeof window) => unknown)
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    const empty = cloneFixture();
    fixtureBody(empty).totalCount = 0;
    fixtureBody(empty).items.item = [];
    expect(normalize(empty, MARKET_INDEXES[0], window)).toEqual({
      ...MARKET_INDEXES[0],
      observation: null,
      status: 'empty',
    });

    const providerError = cloneFixture() as {
      response: { header: { resultCode: string; resultMsg: string } };
    };
    providerError.response.header.resultCode = '30';
    providerError.response.header.resultMsg = 'SERVICE KEY IS NOT REGISTERED';
    expect(() => normalize(providerError, MARKET_INDEXES[0], window)).toThrow(/non-success/i);
  });

  it.each([
    [
      'duplicate date',
      (input: Record<string, unknown>) => {
        const rows = fixtureRows(input);
        rows.push(structuredClone(firstFixtureRow(input)));
        fixtureBody(input).totalCount = rows.length;
      },
    ],
    ['wrong index name', (input: Record<string, unknown>) => (firstFixtureRow(input).idxNm = '코스피 200')],
    [
      'wrong index classification',
      (input: Record<string, unknown>) => (firstFixtureRow(input).idxCsf = 'KOSDAQ시리즈'),
    ],
    ['invalid date', (input: Record<string, unknown>) => (firstFixtureRow(input).basDt = '20260230')],
    ['date outside request window', (input: Record<string, unknown>) => (firstFixtureRow(input).basDt = '20260706')],
    ['invalid close', (input: Record<string, unknown>) => (firstFixtureRow(input).clpr = 'NaN')],
    ['zero close', (input: Record<string, unknown>) => (firstFixtureRow(input).clpr = '0')],
    ['invalid change', (input: Record<string, unknown>) => (firstFixtureRow(input).vs = '')],
    ['invalid percent', (input: Record<string, unknown>) => (firstFixtureRow(input).fltRt = '0.6%')],
    [
      'inconsistent daily direction',
      (input: Record<string, unknown>) => {
        firstFixtureRow(input).vs = '18.42';
        firstFixtureRow(input).fltRt = '-0.66';
      },
    ],
    ['wrong page', (input: Record<string, unknown>) => (fixtureBody(input).pageNo = 2)],
    ['truncated page', (input: Record<string, unknown>) => (fixtureBody(input).totalCount = 31)],
  ])('rejects %s instead of guessing', (_label, mutate) => {
    const normalize = fsc.normalizeFscMarketIndexResponse as
      | ((input: unknown, definition: (typeof MARKET_INDEXES)[number], searchWindow: typeof window) => unknown)
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    const input = cloneFixture();
    mutate(input);
    expect(() => normalize(input, MARKET_INDEXES[0], window)).toThrow();
  });
});

describe('Financial Services Commission market index transport', () => {
  it('uses the fixed HTTPS endpoint, bounded KST dates and an exact provider name', async () => {
    const fetchIndex = fsc.fetchFscMarketIndex as
      | ((options: {
          definition: (typeof MARKET_INDEXES)[number];
          fetcher: typeof fetch;
          now: number;
          serviceKey: string;
          signal: AbortSignal;
        }) => Promise<unknown>)
      | undefined;
    const resolveWindow = fsc.resolveFscMarketSearchWindow as ((now: number) => unknown) | undefined;

    expect(fetchIndex).toBeTypeOf('function');
    expect(resolveWindow).toBeTypeOf('function');
    if (fetchIndex === undefined || resolveWindow === undefined) {
      return;
    }
    expect(resolveWindow(now)).toEqual(window);

    const serviceKey = 'synthetic-market-secret';
    const controller = new AbortController();
    let requestedUrl: URL | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = new URL(input instanceof URL ? input.href : String(input));
      expect(init).toMatchObject({
        headers: { Accept: 'application/json' },
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      });
      return Response.json(fixture);
    });

    await expect(
      fetchIndex({
        definition: MARKET_INDEXES[0],
        fetcher,
        now,
        serviceKey,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ id: 'kospi', status: 'available' });

    expect(requestedUrl?.origin).toBe('https://apis.data.go.kr');
    expect(requestedUrl?.pathname).toBe('/1160100/service/GetMarketIndexInfoService/getStockMarketIndex');
    expect(Object.fromEntries(requestedUrl?.searchParams ?? [])).toEqual({
      beginBasDt: '20260707',
      endBasDt: '20260729',
      idxNm: '코스피',
      numOfRows: '30',
      pageNo: '1',
      resultType: 'json',
      serviceKey,
    });
  });

  it('redacts the query credential from transport errors and reads only the server identifier', async () => {
    const fetchIndex = fsc.fetchFscMarketIndex as
      | ((options: {
          definition: (typeof MARKET_INDEXES)[number];
          fetcher: typeof fetch;
          now: number;
          serviceKey: string;
          signal: AbortSignal;
        }) => Promise<unknown>)
      | undefined;
    const readCredential = fsc.readFscMarketCredential as
      | ((environment: Readonly<Record<string, string | undefined>>) => string | undefined)
      | undefined;

    expect(fetchIndex).toBeTypeOf('function');
    expect(readCredential).toBeTypeOf('function');
    if (fetchIndex === undefined || readCredential === undefined) {
      return;
    }

    const serviceKey = 'synthetic-market-secret';
    let caught: unknown;
    try {
      await fetchIndex({
        definition: MARKET_INDEXES[0],
        fetcher: async (input) => {
          throw new Error(String(input));
        },
        now,
        serviceKey,
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(serviceKey);
    expect(readCredential({ KOREA_MARKET_INDEX_KEY: '  official-key  ' })).toBe('official-key');
    expect(readCredential({ KOREA_MARKET_INDEX_KEY: ' ' })).toBeUndefined();
    expect(readCredential({ VITE_KOREA_MARKET_INDEX_KEY: 'browser-key' })).toBeUndefined();
  });

  it('accepts either decoded or data.go.kr URL-encoded service keys without double encoding', async () => {
    const fetchIndex = fsc.fetchFscMarketIndex as
      | ((options: {
          definition: (typeof MARKET_INDEXES)[number];
          fetcher: typeof fetch;
          now: number;
          serviceKey: string;
          signal: AbortSignal;
        }) => Promise<unknown>)
      | undefined;

    expect(fetchIndex).toBeTypeOf('function');
    if (fetchIndex === undefined) {
      return;
    }

    const requestedKeys: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requestedKeys.push(
        new URL(input instanceof URL ? input.href : String(input)).searchParams.get('serviceKey') ?? '',
      );
      return Response.json(fixture);
    });

    await fetchIndex({
      definition: MARKET_INDEXES[0],
      fetcher,
      now,
      serviceKey: 'synthetic+market/key=',
      signal: new AbortController().signal,
    });
    await fetchIndex({
      definition: MARKET_INDEXES[0],
      fetcher,
      now,
      serviceKey: 'synthetic%2Bmarket%2Fkey%3D',
      signal: new AbortController().signal,
    });

    expect(requestedKeys).toEqual(['synthetic+market/key=', 'synthetic+market/key=']);
  });

  it('documents only the server-side market credential identifier', () => {
    const environmentExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');

    expect(environmentExample.split(/\r?\n/)).toContain('KOREA_MARKET_INDEX_KEY=');
    expect(environmentExample).not.toContain('VITE_KOREA_MARKET_INDEX_KEY');
  });
});
