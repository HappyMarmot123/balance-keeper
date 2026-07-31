// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WEATHER_REGIONS } from '../../../src/entities/weather/contract';

type KmaForecastSlot = Readonly<{ baseDate: string; baseTime: string }>;
type KmaForecastRegion = (typeof WEATHER_REGIONS)[keyof typeof WEATHER_REGIONS];
type ResolveSlot = (epochMs: number) => KmaForecastSlot;
type FetchForecast = (options: {
  fetcher: typeof fetch;
  region: KmaForecastRegion;
  serviceKey: string;
  signal: AbortSignal;
  slot: KmaForecastSlot;
}) => Promise<unknown>;
type NormalizeForecast = (
  input: unknown,
  regionId: 'seoul',
  expectedSlot: KmaForecastSlot,
  collectionTime: number,
) => unknown;

type MutableFixture = {
  response: {
    body: {
      items: {
        item: Array<{
          baseDate: string;
          baseTime: string;
          category: string;
          fcstDate: string;
          fcstTime: string;
          fcstValue: string | number;
          nx: number;
          ny: number;
        }>;
      };
      numOfRows: number;
      pageNo: number;
      totalCount: number;
    };
  };
};

const providerModule = (await import('../../../src/server/providers/kma')) as Readonly<Record<string, unknown>>;
const resolveSlot = providerModule.resolveKmaShortTermForecastSlot as ResolveSlot | undefined;
const fetchForecast = providerModule.fetchKmaShortTermForecast as FetchForecast | undefined;
const normalizeForecast = providerModule.normalizeKmaShortTermForecast as NormalizeForecast | undefined;
const providerApiAvailable =
  typeof resolveSlot === 'function' && typeof fetchForecast === 'function' && typeof normalizeForecast === 'function';
const providerIt = providerApiAvailable ? it : it.skip;

const fixturePath = resolve(import.meta.dirname, '../../fixtures/kma/short-term-forecast-success.json');
const EXPECTED_SLOT = { baseDate: '20260731', baseTime: '0800' } as const;
const COLLECTION_TIME = Date.parse('2026-07-31T08:25:00+09:00');
const readFixture = (): MutableFixture => JSON.parse(readFileSync(fixturePath, 'utf8')) as MutableFixture;
const hourMs = 60 * 60_000;

describe('KMA short-term forecast provider public API', () => {
  it('exports the approved slot, fetch and normalization functions', () => {
    expect(resolveSlot).toBeTypeOf('function');
    expect(fetchForecast).toBeTypeOf('function');
    expect(normalizeForecast).toBeTypeOf('function');
  });
});

describe('KMA short-term forecast publication slot', () => {
  providerIt.each([
    ['2026-07-31T02:19:59+09:00', { baseDate: '20260730', baseTime: '2300' }],
    ['2026-07-31T02:20:00+09:00', { baseDate: '20260731', baseTime: '0200' }],
    ['2026-01-01T02:19:59+09:00', { baseDate: '20251231', baseTime: '2300' }],
    ['2028-03-01T02:19:59+09:00', { baseDate: '20280229', baseTime: '2300' }],
  ])('uses the latest publication-safe KST slot at %s', (kstTime, expected) => {
    expect(resolveSlot?.(Date.parse(kstTime))).toEqual(expected);
  });
});

describe('KMA short-term forecast normalization', () => {
  providerIt('normalizes two provider hours into a strict 24-hour timeline with explicit gaps', () => {
    const normalized = normalizeForecast?.(readFixture(), 'seoul', EXPECTED_SLOT, COLLECTION_TIME) as {
      issuedAt: number;
      periods: Array<Record<string, unknown>>;
      region: string;
    };
    const firstForecastAt = Date.parse('2026-07-31T09:00:00+09:00');

    expect(normalized).toMatchObject({
      issuedAt: Date.parse('2026-07-31T08:00:00+09:00'),
      region: 'seoul',
    });
    expect(normalized.periods).toHaveLength(24);
    expect(normalized.periods.filter((period) => period.availability === 'available')).toHaveLength(2);
    expect(normalized.periods.filter((period) => period.availability === 'unavailable')).toHaveLength(22);
    expect(normalized.periods.map((period) => period.forecastAt)).toEqual(
      Array.from({ length: 24 }, (_, index) => firstForecastAt + index * hourMs),
    );
    expect(normalized.periods[0]).toEqual({
      availability: 'available',
      forecastAt: firstForecastAt,
      precipitationAmount: { kind: 'none' },
      precipitationProbabilityPercent: 20,
      precipitationType: 'none',
      relativeHumidityPercent: 70,
      skyCondition: 'mostly-cloudy',
      temperatureCelsius: 28,
      windSpeedMetersPerSecond: 2.5,
    });
    expect(normalized.periods[1]).toEqual({
      availability: 'available',
      forecastAt: firstForecastAt + hourMs,
      precipitationAmount: { kind: 'less-than', millimeters: 1 },
      precipitationProbabilityPercent: 60,
      precipitationType: 'rain',
      relativeHumidityPercent: 75,
      skyCondition: 'overcast',
      temperatureCelsius: 29,
      windSpeedMetersPerSecond: 3.1,
    });
  });

  providerIt('keeps a missing first provider hour as an unavailable slot instead of shifting the timeline', () => {
    const fixture = readFixture();
    fixture.response.body.items.item = fixture.response.body.items.item.filter(
      (item) => item.fcstDate !== '20260731' || item.fcstTime !== '0900',
    );
    fixture.response.body.totalCount = fixture.response.body.items.item.length;

    const normalized = normalizeForecast?.(fixture, 'seoul', EXPECTED_SLOT, COLLECTION_TIME) as {
      periods: Array<Record<string, unknown>>;
    };

    expect(normalized.periods[0]).toEqual({
      availability: 'unavailable',
      forecastAt: Date.parse('2026-07-31T09:00:00+09:00'),
    });
    expect(normalized.periods[1]).toMatchObject({
      availability: 'available',
      forecastAt: Date.parse('2026-07-31T10:00:00+09:00'),
      temperatureCelsius: 29,
    });
  });

  providerIt('starts the timeline at the next current KST hour rather than returning expired periods', () => {
    const fixture = readFixture();
    const nextHourItems = fixture.response.body.items.item
      .filter((item) => item.fcstTime === '1000')
      .map((item) => ({ ...item, fcstTime: '1100' }));
    fixture.response.body.items.item.push(...nextHourItems);
    fixture.response.body.totalCount = fixture.response.body.items.item.length;

    const normalized = normalizeForecast?.(
      fixture,
      'seoul',
      EXPECTED_SLOT,
      Date.parse('2026-07-31T10:25:00+09:00'),
    ) as {
      periods: Array<Record<string, unknown>>;
    };

    expect(normalized.periods[0]).toMatchObject({
      availability: 'available',
      forecastAt: Date.parse('2026-07-31T11:00:00+09:00'),
    });
    expect(normalized.periods).toHaveLength(24);
  });

  providerIt.each([
    ['2mm', { kind: 'amount', millimeters: 2 }],
    ['1~3mm', { kind: 'range', maximumMillimeters: 3, minimumMillimeters: 1 }],
    ['30mm 이상', { kind: 'at-least', millimeters: 30 }],
  ])('normalizes the supported PCP amount %s', (rawValue, expected) => {
    const fixture = readFixture();
    const precipitationItem = fixture.response.body.items.item.find(
      (item) => item.category === 'PCP' && item.fcstTime === '0900',
    );
    if (precipitationItem === undefined) {
      throw new TypeError('Forecast fixture must contain a first precipitation item');
    }
    precipitationItem.fcstValue = rawValue;

    const normalized = normalizeForecast?.(fixture, 'seoul', EXPECTED_SLOT, COLLECTION_TIME) as {
      periods: Array<Record<string, unknown>>;
    };

    expect(normalized.periods[0]).toMatchObject({ precipitationAmount: expected });
  });

  providerIt('rejects an extended qualitative PCP code instead of treating it as millimeters', () => {
    const fixture = readFixture();
    const precipitationItem = fixture.response.body.items.item.find(
      (item) => item.category === 'PCP' && item.fcstTime === '0900',
    );
    if (precipitationItem === undefined) {
      throw new TypeError('Forecast fixture must contain a first precipitation item');
    }
    precipitationItem.fcstValue = '1';

    expect(() => normalizeForecast?.(fixture, 'seoul', EXPECTED_SLOT, COLLECTION_TIME)).toThrow();
  });

  providerIt.each([
    [
      'duplicate category',
      (fixture: MutableFixture) => {
        const firstItem = fixture.response.body.items.item[0];
        if (firstItem === undefined) {
          throw new TypeError('Forecast fixture must contain an item');
        }
        fixture.response.body.items.item.push({ ...firstItem });
        fixture.response.body.totalCount += 1;
      },
    ],
    [
      'wrong grid',
      (fixture: MutableFixture) => {
        const firstItem = fixture.response.body.items.item[0];
        if (firstItem === undefined) {
          throw new TypeError('Forecast fixture must contain an item');
        }
        firstItem.nx = 61;
      },
    ],
    [
      'inconsistent pagination',
      (fixture: MutableFixture) => {
        fixture.response.body.totalCount += 1;
      },
    ],
  ])('rejects a %s response instead of returning partial forecast data', (_case, mutate) => {
    const fixture = readFixture();
    mutate(fixture);

    expect(() => normalizeForecast?.(fixture, 'seoul', EXPECTED_SLOT, COLLECTION_TIME)).toThrow();
  });
});

describe('KMA short-term forecast HTTPS boundary', () => {
  providerIt('uses the approved HTTPS endpoint, fixed paging, grid, slot and supplied signal', async () => {
    const controller = new AbortController();
    let capturedUrl: URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = new URL(input instanceof URL ? input.href : String(input));
      capturedInit = init;
      return new Response(JSON.stringify(readFixture()));
    };

    await expect(
      fetchForecast?.({
        fetcher,
        region: WEATHER_REGIONS.seoul,
        serviceKey: 'fixture+/=&service-key',
        signal: controller.signal,
        slot: EXPECTED_SLOT,
      }),
    ).resolves.toEqual(readFixture());

    expect(capturedUrl?.origin).toBe('https://apis.data.go.kr');
    expect(capturedUrl?.pathname).toBe('/1360000/VilageFcstInfoService_2.0/getVilageFcst');
    expect(Object.fromEntries(capturedUrl?.searchParams ?? [])).toEqual({
      ServiceKey: 'fixture+/=&service-key',
      base_date: '20260731',
      base_time: '0800',
      dataType: 'JSON',
      numOfRows: '2000',
      nx: '60',
      ny: '127',
      pageNo: '1',
    });
    expect(capturedInit).toMatchObject({
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
  });

  providerIt('preserves the caller abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('fixture forecast deadline');
    controller.abort(reason);
    const fetcher = async (): Promise<Response> => {
      throw new Error('fetcher must not run after abort');
    };

    await expect(
      fetchForecast?.({
        fetcher,
        region: WEATHER_REGIONS.seoul,
        serviceKey: 'fixture-service-key',
        signal: controller.signal,
        slot: EXPECTED_SLOT,
      }),
    ).rejects.toBe(reason);
  });
});
