// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as kmaModule from '../../../src/server/providers/kma';

const fixturePath = resolve(import.meta.dirname, '../../fixtures/kma/earthquake-success.json');
const environmentExamplePath = resolve(import.meta.dirname, '../../../.env.example');
type KmaFixtureItem = Record<string, unknown> & { tmEqk: number };
type KmaFixture = {
  response: {
    body: {
      items: { item: KmaFixtureItem[] };
      numOfRows: number;
      pageNo: number;
      totalCount: number;
    };
    header: {
      resultCode: string;
      resultMsg: string;
    };
  };
};
const readFixture = (): KmaFixture => JSON.parse(readFileSync(fixturePath, 'utf8')) as KmaFixture;
const kma = kmaModule as Record<string, unknown>;
const sourceTo = Date.parse('2026-07-28T03:00:00.000Z');
const sourceFrom = sourceTo - 3 * 24 * 60 * 60_000;

describe('KMA earthquake provider', () => {
  it('normalizes the latest correction and preserves all native notice references', () => {
    const normalize = kma.normalizeKmaEarthquakePages;

    expect(normalize).toBeTypeOf('function');
    if (typeof normalize !== 'function') {
      return;
    }

    expect(normalize([readFixture()], { from: sourceFrom, to: sourceTo })).toEqual([
      {
        aliases: ['108:42:202607271235:1', '108:42:202607271245:2'],
        depthKm: 11,
        id: '108:202607:42',
        intensity: '최대진도 III',
        latitude: 37.12,
        location: '충북 가상군 남남서쪽 9km 지역',
        longitude: 127.18,
        magnitude: 3.1,
        magnitudeType: null,
        occurredAt: Date.parse('2026-07-27T03:30:05.120Z'),
        provider: 'KMA',
        updatedAt: Date.parse('2026-07-27T03:45:00.000Z'),
      },
    ]);
  });

  it('keeps the same monthly sequence from adjacent months as separate earthquake notices', () => {
    const normalize = kma.normalizeKmaEarthquakePages;

    expect(normalize).toBeTypeOf('function');
    if (typeof normalize !== 'function') {
      return;
    }

    const fixture = readFixture();
    const seed = fixture.response.body.items.item[0];
    if (seed === undefined) {
      throw new TypeError('Synthetic KMA fixture requires one item');
    }
    fixture.response.body.items.item = [
      {
        ...seed,
        cnt: 1,
        tmEqk: 20260630120000,
        tmFc: 202606301205,
        tmSeq: 1,
      },
      {
        ...seed,
        cnt: 1,
        tmEqk: 20260701120000,
        tmFc: 202607011205,
        tmSeq: 1,
      },
    ];
    fixture.response.body.totalCount = 2;
    const windowTo = Date.parse('2026-07-02T15:00:00.000Z');
    const windowFrom = windowTo - 3 * 24 * 60 * 60_000;

    expect(normalize([fixture], { from: windowFrom, to: windowTo })).toMatchObject([
      { id: '108:202607:1' },
      { id: '108:202606:1' },
    ]);
  });

  it.each([
    [
      'provider result',
      (fixture: KmaFixture) => {
        fixture.response.header.resultCode = '99';
      },
    ],
    [
      'page size',
      (fixture: KmaFixture) => {
        fixture.response.body.numOfRows = 10;
      },
    ],
    [
      'page number',
      (fixture: KmaFixture) => {
        fixture.response.body.pageNo = 2;
      },
    ],
    [
      'total count',
      (fixture: KmaFixture) => {
        fixture.response.body.totalCount = 3;
      },
    ],
    [
      'invalid timestamp',
      (fixture: KmaFixture) => {
        const item = fixture.response.body.items.item[0];
        if (item === undefined) {
          throw new TypeError('Synthetic KMA fixture requires one item');
        }
        item.tmEqk = 20260230010000;
      },
    ],
  ])('rejects an invalid %s instead of returning a partial page', (_case, mutate) => {
    const normalize = kma.normalizeKmaEarthquakePages;

    expect(normalize).toBeTypeOf('function');
    if (typeof normalize !== 'function') {
      return;
    }

    const fixture = readFixture();
    mutate(fixture);
    expect(() => normalize([fixture], { from: sourceFrom, to: sourceTo })).toThrow();
  });

  it('uses the official lowercase serviceKey, one encoding pass, JSON and the three-day KST range', async () => {
    const fetchRecords = kma.fetchKmaEarthquakeRecords;

    expect(fetchRecords).toBeTypeOf('function');
    if (typeof fetchRecords !== 'function') {
      return;
    }

    const requestedUrls: URL[] = [];
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrls.push(new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url));
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', signal });
      return Response.json(readFixture());
    });

    await expect(
      fetchRecords({
        fetcher,
        serviceKey: 'synthetic%2Bkey%3D',
        signal,
        window: { from: sourceFrom, to: sourceTo },
      }),
    ).resolves.toHaveLength(1);

    expect(requestedUrls).toHaveLength(1);
    const url = requestedUrls[0];
    expect(url?.origin).toBe('https://apis.data.go.kr');
    expect(url?.pathname).toBe('/1360000/EqkInfoService/getEqkMsg');
    expect(url?.searchParams.get('serviceKey')).toBe('synthetic+key=');
    expect(url?.searchParams.has('ServiceKey')).toBe(false);
    expect(url?.searchParams.get('dataType')).toBe('JSON');
    expect(url?.searchParams.get('numOfRows')).toBe('100');
    expect(url?.searchParams.get('pageNo')).toBe('1');
    expect(url?.searchParams.get('fromTmFc')).toBe('20260725');
    expect(url?.searchParams.get('toTmFc')).toBe('20260728');
  });

  it('fetches every declared page without exceeding the bounded result limit', async () => {
    const fetchRecords = kma.fetchKmaEarthquakeRecords;

    expect(fetchRecords).toBeTypeOf('function');
    if (typeof fetchRecords !== 'function') {
      return;
    }

    const requestedPages: string[] = [];
    const firstPage = readFixture();
    const firstItem = firstPage.response.body.items.item[0];
    if (firstItem === undefined) {
      throw new TypeError('Synthetic KMA first page requires one item');
    }
    firstPage.response.body.items.item = [firstItem];
    firstPage.response.body.totalCount = 101;
    const secondPage = readFixture();
    const secondItem = secondPage.response.body.items.item[1];
    if (secondItem === undefined) {
      throw new TypeError('Synthetic KMA second page requires one item');
    }
    secondPage.response.body.items.item = [secondItem];
    secondPage.response.body.pageNo = 2;
    secondPage.response.body.totalCount = 101;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
      const pageNo = url.searchParams.get('pageNo') ?? '';
      requestedPages.push(pageNo);
      return Response.json(pageNo === '1' ? firstPage : secondPage);
    });

    await expect(
      fetchRecords({
        fetcher,
        serviceKey: 'synthetic-key',
        signal: new AbortController().signal,
        window: { from: sourceFrom, to: sourceTo },
      }),
    ).rejects.toThrow(/pagination|count/i);
    expect(requestedPages).toEqual(['1', '2']);
  });

  it('forwards cancellation and never converts it to a provider failure', async () => {
    const fetchRecords = kma.fetchKmaEarthquakeRecords;

    expect(fetchRecords).toBeTypeOf('function');
    if (typeof fetchRecords !== 'function') {
      return;
    }

    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(reason), { once: true });
      });
    });
    const pending = fetchRecords({
      fetcher,
      serviceKey: 'synthetic-key',
      signal: controller.signal,
      window: { from: sourceFrom, to: sourceTo },
    });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it('owns a dedicated server-only environment identifier', () => {
    const readCredential = kma.readKmaEarthquakeCredential;

    expect(readCredential).toBeTypeOf('function');
    if (typeof readCredential !== 'function') {
      return;
    }

    expect(readCredential({ KOREA_EARTHQUAKE_KEY: '  dedicated-key  ' })).toBe('dedicated-key');
    expect(readCredential({ DATA_GO_KR_SERVICE_KEY: 'weather-key' })).toBeUndefined();
    expect(readCredential({ KOREA_EARTHQUAKE_KEY: '   ' })).toBeUndefined();

    const envExample = readFileSync(environmentExamplePath, 'utf8');
    expect(envExample.split(/\r?\n/)).toContain('KOREA_EARTHQUAKE_KEY=');
    expect(envExample).not.toContain('VITE_KOREA_EARTHQUAKE_KEY');
  });
});
