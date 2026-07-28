// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { MACRO_SERIES } from '../../../src/entities/macro';
import { createAdmissionSubject } from '../../../src/server/gateway';
import type { createMacroRoute } from '../../../src/server/routes/macro';
import * as macroRouteModule from '../../../src/server/routes/macro';

const macroRoute = macroRouteModule as Record<string, unknown>;
const now = Date.parse('2026-07-28T03:00:00.000Z');

const responseFor = (series: (typeof MACRO_SERIES)[number], value: string, period: string) =>
  Response.json({
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

const createFetcher = (failCode?: string) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const pathname = new URL(input instanceof URL ? input.href : String(input)).pathname;
    const series = MACRO_SERIES.find((candidate) => pathname.includes(`/${candidate.statCode}/`));
    if (series === undefined) {
      return new Response(null, { status: 404 });
    }
    if (series.statCode === failCode) {
      return new Response(null, { status: 503 });
    }
    if (series.id === 'usd-krw') {
      return responseFor(series, '1382.4', '20260728');
    }
    if (series.id === 'base-rate') {
      return responseFor(series, '2.5', '20260728');
    }
    return responseFor(series, '418300000', '202606');
  });

const createRoute = (overrides: Record<string, unknown> = {}) => {
  const factory = macroRoute.createMacroRoute as
    | ((options: Record<string, unknown>) => ReturnType<typeof createMacroRoute>)
    | undefined;
  expect(factory).toBeTypeOf('function');
  if (factory === undefined) {
    throw new TypeError('createMacroRoute is missing');
  }
  return factory({
    clock: () => now,
    fetcher: createFetcher(),
    readAdmissionSubject: () => createAdmissionSubject('macro-test'),
    serviceKey: 'synthetic-ecos-key',
    ...overrides,
  });
};

describe('macro gateway route', () => {
  it('uses a fixed queryless cache identity and a coarse daily/monthly cache profile', () => {
    const route = createRoute();

    expect(route.path).toBe('/api/macro');
    expect(route.parseRequest(new Request('https://balance.test/api/macro'))).toEqual({
      admissionSubject: createAdmissionSubject('macro-test'),
      input: {},
      publicCacheIdentity: { scope: 'korea-core-macro' },
    });
    expect(() => route.parseRequest(new Request('https://balance.test/api/macro?code=731Y001'))).toThrowError(
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

  it('returns all three observations in canonical order', async () => {
    const route = createRoute();

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      kind: 'value',
      data: {
        series: [
          { id: 'usd-krw', observation: { period: '20260728', value: 1382.4 }, status: 'available' },
          { id: 'base-rate', observation: { period: '20260728', value: 2.5 }, status: 'available' },
          { id: 'fx-reserves', observation: { period: '202606', value: 4183 }, status: 'available' },
        ],
      },
      fetchedAt: now,
      source: 'ECOS',
    });
  });

  it('keeps successful series when one provider request fails', async () => {
    const route = createRoute({ fetcher: createFetcher('722Y001') });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      kind: 'value',
      data: {
        series: [
          { id: 'usd-krw', status: 'available' },
          { id: 'base-rate', observation: null, status: 'unavailable' },
          { id: 'fx-reserves', status: 'available' },
        ],
      },
    });
  });

  it('negative-caches only a fully successful no-data result', async () => {
    const route = createRoute({
      fetcher: vi.fn(async () => Response.json({ RESULT: { CODE: 'INFO-200', MESSAGE: 'NO DATA' } })),
    });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      kind: 'empty',
      data: {
        series: [{ status: 'empty' }, { status: 'empty' }, { status: 'empty' }],
      },
    });
  });

  it('fails before transport without a credential and fails as upstream unavailable when every series fails', async () => {
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
