// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type FetchWeatherAlerts = (options: {
  clock: () => number;
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}) => Promise<unknown>;

type NormalizeWeatherAlerts = (
  input: {
    bulletin: unknown | null;
    bulletinAvailable: boolean;
    codes: unknown | null;
    status: unknown;
  },
  collectionTime: number,
) => unknown;

type MutableCodeFixture = {
  response: {
    body: {
      items: {
        item: Array<{
          areaCode: string;
          command: number;
          endTime: string;
          startTime: string;
          warnStress: number;
          warnVar: number;
        }>;
      };
      totalCount: number;
    };
  };
};

const providerModule = (await import('../../../src/server/providers/kma')) as Readonly<Record<string, unknown>>;
const fetchWeatherAlerts = providerModule.fetchKmaWeatherAlerts as FetchWeatherAlerts | undefined;
const normalizeWeatherAlerts = providerModule.normalizeKmaWeatherAlerts as NormalizeWeatherAlerts | undefined;
const providerAvailable = typeof fetchWeatherAlerts === 'function' && typeof normalizeWeatherAlerts === 'function';
const providerIt = providerAvailable ? it : it.skip;

const fixtureDirectory = resolve(import.meta.dirname, '../../fixtures/kma');
const readFixture = <Fixture = unknown>(name: string): Fixture =>
  JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8')) as Fixture;

const STATUS_ACTIVE = 'weather-alert-status-active.json';
const STATUS_EMPTY = 'weather-alert-status-empty.json';
const CODES_ACTIVE = 'weather-alert-codes-active.json';
const MESSAGE_SUCCESS = 'weather-alert-message-success.json';
const COLLECTION_TIME = Date.parse('2026-07-31T12:00:00+09:00');

const createProviderFetcher = (options: { bulletinResponse?: Response; codes?: unknown; status?: unknown } = {}) =>
  vi.fn<typeof fetch>(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
    switch (url.pathname) {
      case '/1360000/WthrWrnInfoService/getPwnStatus':
        return Response.json(options.status ?? readFixture(STATUS_ACTIVE));
      case '/1360000/WthrWrnInfoService/getPwnCd':
        return Response.json(options.codes ?? readFixture(CODES_ACTIVE));
      case '/1360000/WthrWrnInfoService/getWthrWrnMsg':
        return options.bulletinResponse ?? Response.json(readFixture(MESSAGE_SUCCESS));
      default:
        throw new TypeError(`Unexpected fixture endpoint: ${url.pathname}`);
    }
  });

describe('KMA weather alert provider public API', () => {
  it('exports the approved fetch and normalization functions', () => {
    expect(fetchWeatherAlerts).toBeTypeOf('function');
    expect(normalizeWeatherAlerts).toBeTypeOf('function');
  });
});

describe('KMA weather alert normalization', () => {
  providerIt('cross-checks the current status with structured lifecycle rows', () => {
    const normalized = normalizeWeatherAlerts?.(
      {
        bulletin: readFixture(MESSAGE_SUCCESS),
        bulletinAvailable: true,
        codes: readFixture(CODES_ACTIVE),
        status: readFixture(STATUS_ACTIVE),
      },
      COLLECTION_TIME,
    ) as {
      alerts: Array<Record<string, unknown>>;
      bulletin: Record<string, unknown>;
      statusEffectiveAt: number;
      statusIssuedAt: number;
    };

    expect(normalized).toEqual({
      alerts: [
        {
          areaCode: 'L1010100',
          areaName: '서울특별시',
          command: 'change-issue',
          commandCode: 7,
          effectiveAt: Date.parse('2026-07-31T10:00:00+09:00'),
          endsAt: Date.parse('2026-07-31T18:00:00+09:00'),
          id: '202607310900-31-L1010100-12',
          issuedAt: Date.parse('2026-07-31T09:00:00+09:00'),
          kind: 'heat-wave',
          kindCode: 12,
          level: 'warning',
          levelCode: 1,
        },
        {
          areaCode: 'L1020000',
          areaName: '경기도 일부',
          command: 'extend',
          commandCode: 3,
          effectiveAt: Date.parse('2026-07-31T11:00:00+09:00'),
          endsAt: null,
          id: '202607311000-32-L1020000-12',
          issuedAt: Date.parse('2026-07-31T10:00:00+09:00'),
          kind: 'heat-wave',
          kindCode: 12,
          level: 'advisory',
          levelCode: 0,
        },
      ],
      bulletin: {
        availability: 'available',
        details: '야외 활동과 온열질환에 유의하십시오.',
        issuedAt: Date.parse('2026-07-31T09:00:00+09:00'),
        title: '폭염경보·폭염주의보 발표',
      },
      statusEffectiveAt: Date.parse('2026-07-31T10:00:00+09:00'),
      statusIssuedAt: Date.parse('2026-07-31T09:00:00+09:00'),
    });
  });

  providerIt('returns a real empty result only when the status authority says there is no active warning', () => {
    expect(
      normalizeWeatherAlerts?.(
        {
          bulletin: null,
          bulletinAvailable: false,
          codes: null,
          status: readFixture(STATUS_EMPTY),
        },
        COLLECTION_TIME,
      ),
    ).toBeNull();
  });

  providerIt('preserves undocumented kind and level codes as explicit unknown values', () => {
    const codes = readFixture<MutableCodeFixture>(CODES_ACTIVE);
    for (const item of codes.response.body.items.item) {
      if (item.areaCode === 'L1010100') {
        item.warnVar = 99;
        item.warnStress = 9;
      }
    }

    const normalized = normalizeWeatherAlerts?.(
      {
        bulletin: null,
        bulletinAvailable: false,
        codes,
        status: readFixture(STATUS_ACTIVE),
      },
      COLLECTION_TIME,
    ) as { alerts: Array<Record<string, unknown>> };

    expect(normalized.alerts.find(({ areaCode }) => areaCode === 'L1010100')).toMatchObject({
      kind: 'unknown',
      kindCode: 99,
      level: 'unknown',
      levelCode: 9,
    });
  });

  providerIt('fails closed on pagination contradictions, undocumented commands and active-text mismatches', () => {
    const paginationMismatch = readFixture<MutableCodeFixture>(CODES_ACTIVE);
    paginationMismatch.response.body.totalCount += 1;
    expect(() =>
      normalizeWeatherAlerts?.(
        {
          bulletin: null,
          bulletinAvailable: false,
          codes: paginationMismatch,
          status: readFixture(STATUS_ACTIVE),
        },
        COLLECTION_TIME,
      ),
    ).toThrow();

    const unknownCommand = readFixture<MutableCodeFixture>(CODES_ACTIVE);
    const undocumentedCommandRow = unknownCommand.response.body.items.item[3];
    if (undocumentedCommandRow === undefined) {
      throw new TypeError('Synthetic lifecycle fixture must include an undocumented-command target');
    }
    undocumentedCommandRow.command = 5;
    expect(() =>
      normalizeWeatherAlerts?.(
        {
          bulletin: null,
          bulletinAvailable: false,
          codes: unknownCommand,
          status: readFixture(STATUS_ACTIVE),
        },
        COLLECTION_TIME,
      ),
    ).toThrow();

    const noStructuredActive = readFixture<MutableCodeFixture>(CODES_ACTIVE);
    for (const item of noStructuredActive.response.body.items.item) {
      if ([1, 3, 6, 7].includes(item.command)) {
        item.command = 2;
        item.startTime = '';
        item.endTime = '202607311100';
      }
    }
    expect(() =>
      normalizeWeatherAlerts?.(
        {
          bulletin: null,
          bulletinAvailable: false,
          codes: noStructuredActive,
          status: readFixture(STATUS_ACTIVE),
        },
        COLLECTION_TIME,
      ),
    ).toThrow();
  });

  providerIt('matches bulletin enrichment to the authoritative current status identity', () => {
    const bulletin = readFixture<{
      response: {
        body: {
          items: {
            item: Array<Record<string, unknown>>;
          };
          totalCount: number;
        };
      };
    }>(MESSAGE_SUCCESS);
    const matching = bulletin.response.body.items.item[0];
    if (matching === undefined) {
      throw new TypeError('Synthetic bulletin fixture must include the matching status item');
    }
    bulletin.response.body.items.item.push({
      ...matching,
      t1: '다른 최신 통보문',
      tmFc: '202607311000',
      tmSeq: 32,
    });
    bulletin.response.body.totalCount += 1;

    const normalized = normalizeWeatherAlerts?.(
      {
        bulletin,
        bulletinAvailable: true,
        codes: readFixture(CODES_ACTIVE),
        status: readFixture(STATUS_ACTIVE),
      },
      COLLECTION_TIME,
    ) as { bulletin: Record<string, unknown> };

    expect(normalized.bulletin).toMatchObject({
      availability: 'available',
      title: '폭염경보·폭염주의보 발표',
    });
  });

  providerIt('deduplicates identical provider events but rejects conflicting event identities', () => {
    const duplicate = readFixture<MutableCodeFixture>(CODES_ACTIVE);
    const original = duplicate.response.body.items.item[1];
    if (original === undefined) {
      throw new TypeError('Synthetic lifecycle fixture must include a duplicate target');
    }
    duplicate.response.body.items.item.push({ ...original });
    duplicate.response.body.totalCount += 1;
    const deduplicated = normalizeWeatherAlerts?.(
      {
        bulletin: null,
        bulletinAvailable: false,
        codes: duplicate,
        status: readFixture(STATUS_ACTIVE),
      },
      COLLECTION_TIME,
    ) as { alerts: unknown[] };
    expect(deduplicated.alerts).toHaveLength(2);

    const conflict = readFixture<MutableCodeFixture>(CODES_ACTIVE);
    const conflictTarget = conflict.response.body.items.item[1];
    if (conflictTarget === undefined) {
      throw new TypeError('Synthetic lifecycle fixture must include a conflict target');
    }
    conflict.response.body.items.item.push({
      ...conflictTarget,
      warnStress: conflictTarget.warnStress === 0 ? 1 : 0,
    });
    conflict.response.body.totalCount += 1;
    expect(() =>
      normalizeWeatherAlerts?.(
        {
          bulletin: null,
          bulletinAvailable: false,
          codes: conflict,
          status: readFixture(STATUS_ACTIVE),
        },
        COLLECTION_TIME,
      ),
    ).toThrow();
  });
});

describe('KMA weather alert HTTPS boundary', () => {
  providerIt('uses three bounded official HTTPS requests and a six-day KST lifecycle window', async () => {
    const fetcher = createProviderFetcher();
    const controller = new AbortController();

    await expect(
      fetchWeatherAlerts?.({
        clock: () => COLLECTION_TIME,
        fetcher,
        serviceKey: 'fixture%2B%2F%3D-key',
        signal: controller.signal,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        alerts: expect.arrayContaining([expect.objectContaining({ areaCode: 'L1010100' })]),
      }),
    );

    expect(fetcher).toHaveBeenCalledTimes(3);
    const calls = fetcher.mock.calls.map(([input, init]) => ({
      init,
      url: new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url),
    }));
    expect(calls.map(({ url }) => url.origin)).toEqual([
      'https://apis.data.go.kr',
      'https://apis.data.go.kr',
      'https://apis.data.go.kr',
    ]);
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      '/1360000/WthrWrnInfoService/getPwnStatus',
      '/1360000/WthrWrnInfoService/getPwnCd',
      '/1360000/WthrWrnInfoService/getWthrWrnMsg',
    ]);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      dataType: 'JSON',
      numOfRows: '10',
      pageNo: '1',
      serviceKey: 'fixture+/=-key',
    });
    expect(Object.fromEntries(calls[1]?.url.searchParams ?? [])).toEqual({
      dataType: 'JSON',
      fromTmFc: '20260726',
      numOfRows: '1000',
      pageNo: '1',
      serviceKey: 'fixture+/=-key',
      toTmFc: '20260731',
    });
    expect(Object.fromEntries(calls[2]?.url.searchParams ?? [])).toEqual({
      dataType: 'JSON',
      fromTmFc: '20260730',
      numOfRows: '100',
      pageNo: '1',
      serviceKey: 'fixture+/=-key',
      stnId: '108',
      toTmFc: '20260731',
    });
    expect(calls.every(({ init }) => init?.method === 'GET' && init.redirect === 'error')).toBe(true);
    expect(calls.every(({ init }) => init?.signal === controller.signal)).toBe(true);
  });

  providerIt('short-circuits after the current status when no warning is active', async () => {
    const fetcher = createProviderFetcher({ status: readFixture(STATUS_EMPTY) });

    await expect(
      fetchWeatherAlerts?.({
        clock: () => COLLECTION_TIME,
        fetcher,
        serviceKey: 'fixture-key',
        signal: new AbortController().signal,
      }),
    ).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  providerIt('keeps the active snapshot when optional bulletin enrichment fails', async () => {
    const fetcher = createProviderFetcher({
      bulletinResponse: new Response('provider detail must not escape', { status: 503 }),
    });

    await expect(
      fetchWeatherAlerts?.({
        clock: () => COLLECTION_TIME,
        fetcher,
        serviceKey: 'fixture-key',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        alerts: expect.arrayContaining([expect.objectContaining({ areaCode: 'L1010100' })]),
        bulletin: expect.objectContaining({ availability: 'unavailable' }),
      }),
    );
  });

  providerIt('preserves the caller abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('fixture alert deadline');
    const fetcher = vi.fn(async (): Promise<Response> => {
      controller.abort(reason);
      throw new TypeError('fetch aborted');
    });

    await expect(
      fetchWeatherAlerts?.({
        clock: () => COLLECTION_TIME,
        fetcher,
        serviceKey: 'fixture-key',
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
  });
});
