// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { MACRO_SERIES } from '../../../src/entities/macro';
import * as ecosModule from '../../../src/server/providers/ecos';

const ecos = ecosModule as Record<string, unknown>;
const now = Date.parse('2026-07-28T03:00:00.000Z');

const createRow = (
  series: (typeof MACRO_SERIES)[number],
  period: string,
  value: string,
): Record<string, string | null> => ({
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
});

const success = (
  _series: (typeof MACRO_SERIES)[number],
  rows: Array<Record<string, string | null>>,
  total = rows.length,
) => ({
  StatisticSearch: {
    list_total_count: total,
    row: rows,
  },
});

const changeFirstRow = (
  rows: Array<Record<string, string | null>>,
  change: Record<string, string | null>,
): Array<Record<string, string | null>> => {
  const first = rows[0];
  if (first === undefined) {
    throw new TypeError('Synthetic ECOS rows must contain one item');
  }
  return [{ ...first, ...change }];
};

describe('ECOS macro provider normalization', () => {
  it('selects the latest TIME explicitly and normalizes thousand dollars to hundred-million dollars', () => {
    const normalize = ecos.normalizeEcosMacroResponse as
      | ((input: unknown, series: (typeof MACRO_SERIES)[number]) => unknown)
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    expect(
      normalize(
        success(MACRO_SERIES[2], [
          createRow(MACRO_SERIES[2], '202604', '417900000'),
          createRow(MACRO_SERIES[2], '202606', '418300000'),
          createRow(MACRO_SERIES[2], '202605', '418000000'),
        ]),
        MACRO_SERIES[2],
      ),
    ).toEqual({
      ...MACRO_SERIES[2],
      observation: {
        period: '202606',
        sourceValue: 418_300_000,
        value: 4_183,
      },
      status: 'available',
    });
  });

  it('recognizes only INFO-200 as an empty observation', () => {
    const normalize = ecos.normalizeEcosMacroResponse as
      | ((input: unknown, series: (typeof MACRO_SERIES)[number]) => unknown)
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    expect(normalize({ RESULT: { CODE: 'INFO-200', MESSAGE: 'NO DATA' } }, MACRO_SERIES[0])).toEqual({
      ...MACRO_SERIES[0],
      observation: null,
      status: 'empty',
    });
    expect(() => normalize({ RESULT: { CODE: 'ERROR-602', MESSAGE: 'RATE LIMITED' } }, MACRO_SERIES[0])).toThrow(
      /non-success/i,
    );
  });

  it.each([
    [
      'duplicate period',
      (rows: Array<Record<string, string | null>>) => {
        const first = rows[0];
        if (first === undefined) {
          throw new TypeError('Synthetic ECOS rows must contain one item');
        }
        return [first, first];
      },
    ],
    ['wrong statistic', (rows: Array<Record<string, string | null>>) => changeFirstRow(rows, { STAT_CODE: 'WRONG' })],
    ['wrong item', (rows: Array<Record<string, string | null>>) => changeFirstRow(rows, { ITEM_CODE1: 'WRONG' })],
    ['wrong unit', (rows: Array<Record<string, string | null>>) => changeFirstRow(rows, { UNIT_NAME: '백만달러' })],
    ['invalid number', (rows: Array<Record<string, string | null>>) => changeFirstRow(rows, { DATA_VALUE: 'NaN' })],
    ['invalid period', (rows: Array<Record<string, string | null>>) => changeFirstRow(rows, { TIME: '202613' })],
  ])('rejects %s instead of guessing', (_label, mutate) => {
    const normalize = ecos.normalizeEcosMacroResponse as
      | ((input: unknown, series: (typeof MACRO_SERIES)[number]) => unknown)
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    const rows = mutate([createRow(MACRO_SERIES[2], '202606', '418300000')]);
    expect(() => normalize(success(MACRO_SERIES[2], rows), MACRO_SERIES[2])).toThrow();
  });

  it('rejects a response truncated beyond the requested 100-row page', () => {
    const normalize = ecos.normalizeEcosMacroResponse as
      | ((input: unknown, series: (typeof MACRO_SERIES)[number]) => unknown)
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    expect(() =>
      normalize(success(MACRO_SERIES[0], [createRow(MACRO_SERIES[0], '20260728', '1382.4')], 101), MACRO_SERIES[0]),
    ).toThrow(/pagination/i);
  });
});

describe('ECOS StatisticSearch transport', () => {
  it('builds the fixed official path, forwards cancellation and never leaks the key through errors', async () => {
    const fetchSeries = ecos.fetchEcosMacroSeries as
      | ((options: {
          fetcher: typeof fetch;
          now: number;
          series: (typeof MACRO_SERIES)[number];
          serviceKey: string;
          signal: AbortSignal;
        }) => Promise<unknown>)
      | undefined;

    expect(fetchSeries).toBeTypeOf('function');
    if (fetchSeries === undefined) {
      return;
    }

    const serviceKey = 'synthetic-ecos-secret';
    let requestedUrl = '';
    const controller = new AbortController();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = input instanceof URL ? input.href : String(input);
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', signal: controller.signal });
      return Response.json(success(MACRO_SERIES[0], [createRow(MACRO_SERIES[0], '20260728', '1382.4')]));
    });

    await expect(
      fetchSeries({
        fetcher,
        now,
        series: MACRO_SERIES[0],
        serviceKey,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ id: 'usd-krw', status: 'available' });
    expect(new URL(requestedUrl).pathname).toBe(
      `/api/StatisticSearch/${serviceKey}/json/kr/1/100/731Y001/D/20260613/20260728/0000001/`,
    );

    const failingFetcher = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(String(input));
    });
    let caught: unknown;
    try {
      await fetchSeries({
        fetcher: failingFetcher,
        now,
        series: MACRO_SERIES[0],
        serviceKey,
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(serviceKey);
  });

  it('rejects an observation outside the requested KST search window', async () => {
    const fetchSeries = ecos.fetchEcosMacroSeries as
      | ((options: {
          fetcher: typeof fetch;
          now: number;
          series: (typeof MACRO_SERIES)[number];
          serviceKey: string;
          signal: AbortSignal;
        }) => Promise<unknown>)
      | undefined;

    expect(fetchSeries).toBeTypeOf('function');
    if (fetchSeries === undefined) {
      return;
    }

    await expect(
      fetchSeries({
        fetcher: async () =>
          Response.json(success(MACRO_SERIES[0], [createRow(MACRO_SERIES[0], '20260612', '1382.4')])),
        now,
        series: MACRO_SERIES[0],
        serviceKey: 'synthetic-ecos-key',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/window/i);
  });

  it('reads only the server-side ECOS credential', () => {
    const readCredential = ecos.readEcosCredential as
      | ((environment: Readonly<Record<string, string | undefined>>) => string | undefined)
      | undefined;

    expect(readCredential).toBeTypeOf('function');
    if (readCredential === undefined) {
      return;
    }

    expect(readCredential({ ECOS_API_KEY: '  official-key  ' })).toBe('official-key');
    expect(readCredential({ ECOS_API_KEY: ' ' })).toBeUndefined();
    expect(readCredential({ VITE_ECOS_API_KEY: 'browser-key' })).toBeUndefined();
  });
});
