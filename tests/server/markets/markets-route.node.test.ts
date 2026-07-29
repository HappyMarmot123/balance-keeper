// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { MARKET_INDEXES } from '../../../src/entities/market';
import { createAdmissionSubject } from '../../../src/server/gateway';
import type { createMarketsRoute } from '../../../src/server/routes/markets';
import * as marketsRouteModule from '../../../src/server/routes/markets';

const marketsRoute = marketsRouteModule as Record<string, unknown>;
const now = Date.parse('2026-07-28T03:00:00.000Z');

const responseFor = (definition: (typeof MARKET_INDEXES)[number]) => {
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
      header: {
        resultCode: '00',
        resultMsg: 'NORMAL SERVICE.',
      },
    },
  });
};

const emptyResponse = () =>
  Response.json({
    response: {
      body: {
        items: { item: [] },
        numOfRows: 30,
        pageNo: 1,
        totalCount: 0,
      },
      header: {
        resultCode: '00',
        resultMsg: 'NORMAL SERVICE.',
      },
    },
  });

const createFetcher = (failingIndex?: string) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const providerName = new URL(input instanceof URL ? input.href : String(input)).searchParams.get('idxNm');
    const definition = MARKET_INDEXES.find((candidate) => candidate.providerName === providerName);
    if (definition === undefined) {
      return new Response(null, { status: 404 });
    }
    if (definition.id === failingIndex) {
      return new Response(null, { status: 503 });
    }
    return responseFor(definition);
  });

const createRoute = (overrides: Record<string, unknown> = {}) => {
  const factory = marketsRoute.createMarketsRoute as
    | ((options: Record<string, unknown>) => ReturnType<typeof createMarketsRoute>)
    | undefined;
  expect(factory).toBeTypeOf('function');
  if (factory === undefined) {
    throw new TypeError('createMarketsRoute is missing');
  }
  return factory({
    clock: () => now,
    fetcher: createFetcher(),
    readAdmissionSubject: () => createAdmissionSubject('markets-test'),
    serviceKey: 'synthetic-market-key',
    ...overrides,
  });
};

describe('markets gateway route', () => {
  it('uses a fixed queryless cache identity and a daily delayed-data profile', () => {
    const route = createRoute();

    expect(route.path).toBe('/api/markets');
    expect(route.parseRequest(new Request('https://balance.test/api/markets'))).toEqual({
      admissionSubject: createAdmissionSubject('markets-test'),
      input: {},
      publicCacheIdentity: { scope: 'korea-delayed-markets' },
    });
    expect(() => route.parseRequest(new Request('https://balance.test/api/markets?symbol=KOSPI'))).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
    expect(route.profile).toMatchObject({
      cdnMaxAgeSeconds: 60 * 60,
      freshForMs: 6 * 60 * 60_000,
      negativeForMs: 60 * 60_000,
      staleIfErrorForMs: 7 * 24 * 60 * 60_000,
      upstreamTimeoutMs: 8_000,
    });
  });

  it('returns both domestic closes in canonical order with explicit delayed source attribution', async () => {
    const route = createRoute();

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      kind: 'value',
      data: {
        indices: [
          {
            id: 'kospi',
            observation: { change: 18.42, changePercent: 0.66, close: 2811.72, date: '20260727' },
            status: 'available',
          },
          {
            id: 'kosdaq',
            observation: { change: -3.15, changePercent: -0.39, close: 807.41, date: '20260727' },
            status: 'available',
          },
        ],
      },
      fetchedAt: now,
      source: '금융위원회 · 한국거래소 통계정보',
    });
  });

  it('keeps a successful index when the other provider request fails', async () => {
    const route = createRoute({ fetcher: createFetcher('kosdaq') });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      kind: 'value',
      data: {
        indices: [
          { id: 'kospi', status: 'available' },
          { id: 'kosdaq', observation: null, status: 'unavailable' },
        ],
      },
    });
  });

  it('negative-caches only a fully successful no-data result', async () => {
    const route = createRoute({ fetcher: vi.fn(async () => emptyResponse()) });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      kind: 'empty',
      data: {
        indices: [{ status: 'empty' }, { status: 'empty' }],
      },
    });
  });

  it('does not call upstream without a credential and fails only when both index requests fail', async () => {
    const missingFetcher = vi.fn();
    const missingRoute = createRoute({ fetcher: missingFetcher, serviceKey: undefined });

    await expect(missingRoute.load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(missingFetcher).not.toHaveBeenCalled();

    const unavailableRoute = createRoute({
      fetcher: vi.fn(async () => new Response(null, { status: 503 })),
    });
    await expect(unavailableRoute.load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});
