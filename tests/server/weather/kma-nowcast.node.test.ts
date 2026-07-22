import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEATHER_REGIONS } from '../../../src/entities/weather';
import {
  fetchKmaUltraShortNowcast,
  KMA_WEATHER_REGIONS,
  normalizeKmaUltraShortNowcast,
  readKmaWeatherCredential,
  resolveKmaNowcastSlot,
} from '../../../src/server/providers/kma';

type FixtureItem = Readonly<{
  baseDate: string;
  baseTime: string;
  category: string;
  nx: number;
  ny: number;
  obsrValue: string;
}>;

type NowcastFixture = {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      dataType: string;
      items: { item: FixtureItem[] };
      pageNo: number;
      numOfRows: number;
      totalCount: number;
    };
  };
};

const fixturePath = resolve(import.meta.dirname, '../../fixtures/kma/ultra-short-nowcast-success.json');
const EXPECTED_SLOT = { baseDate: '20260722', baseTime: '1400' } as const;
const readSuccessFixture = (): NowcastFixture => JSON.parse(readFileSync(fixturePath, 'utf8')) as NowcastFixture;
const normalizeFixture = (input: unknown) => normalizeKmaUltraShortNowcast(input, 'seoul', EXPECTED_SLOT);

const withItems = (items: FixtureItem[]): NowcastFixture => {
  const fixture = readSuccessFixture();
  fixture.response.body.items.item = items;
  fixture.response.body.totalCount = items.length;
  return fixture;
};

describe('KMA weather regions', () => {
  it('owns the seven approved semantic region ids and their fixed KMA grids', () => {
    expect(KMA_WEATHER_REGIONS).toEqual({
      seoul: { id: 'seoul', name: '서울', nx: 60, ny: 127 },
      busan: { id: 'busan', name: '부산', nx: 98, ny: 76 },
      incheon: { id: 'incheon', name: '인천', nx: 55, ny: 124 },
      daegu: { id: 'daegu', name: '대구', nx: 89, ny: 90 },
      gwangju: { id: 'gwangju', name: '광주', nx: 58, ny: 74 },
      daejeon: { id: 'daejeon', name: '대전', nx: 67, ny: 100 },
      jeju: { id: 'jeju', name: '제주', nx: 52, ny: 38 },
    });
    expect(Object.isFrozen(KMA_WEATHER_REGIONS)).toBe(true);
    expect(Object.values(KMA_WEATHER_REGIONS).every(Object.isFrozen)).toBe(true);
    expect(KMA_WEATHER_REGIONS).toBe(WEATHER_REGIONS);
  });
});

describe('KMA hourly nowcast slot', () => {
  it.each([
    ['2026-07-22T00:19:59+09:00', { baseDate: '20260721', baseTime: '2300' }],
    ['2026-07-22T00:20:00+09:00', { baseDate: '20260722', baseTime: '0000' }],
    ['2026-03-01T00:19:59+09:00', { baseDate: '20260228', baseTime: '2300' }],
    ['2026-01-01T00:19:59+09:00', { baseDate: '20251231', baseTime: '2300' }],
  ])('uses a fixed 20-minute publication lag at %s', (kstTime, expected) => {
    expect(resolveKmaNowcastSlot(Date.parse(kstTime))).toEqual(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an unsafe clock value: %s',
    (epochMs) => {
      expect(() => resolveKmaNowcastSlot(epochMs)).toThrow();
    },
  );
});

describe('KMA ultra-short nowcast normalization', () => {
  it('normalizes the provider fixture into the public weather contract', () => {
    expect(normalizeFixture(readSuccessFixture())).toEqual({
      region: 'seoul',
      observedAt: Date.parse('2026-07-22T14:00:00+09:00'),
      temperatureCelsius: 27.4,
      relativeHumidityPercent: 68,
      precipitationLastHourMm: 0,
      precipitationType: 'none',
      windSpeedMetersPerSecond: 2.5,
      windDirectionDegrees: 270,
    });
  });

  it('preserves a partial observation by setting only missing supported categories to null', () => {
    const items = readSuccessFixture().response.body.items.item.filter(
      ({ category }) => category !== 'RN1' && category !== 'VEC',
    );

    expect(normalizeFixture(withItems(items))).toMatchObject({
      precipitationLastHourMm: null,
      windDirectionDegrees: null,
      temperatureCelsius: 27.4,
      relativeHumidityPercent: 68,
    });
  });

  it('returns null when no supported observation category exists', () => {
    const vectorOnly = readSuccessFixture().response.body.items.item.filter(
      ({ category }) => category === 'UUU' || category === 'VVV',
    );

    expect(normalizeFixture(withItems(vectorOnly))).toBeNull();
  });

  it('returns null for an explicit successful empty provider result', () => {
    expect(normalizeFixture(withItems([]))).toBeNull();
  });

  it('rejects malformed numeric observation values instead of converting them to NaN or null', () => {
    const items = readSuccessFixture().response.body.items.item.map((item) =>
      item.category === 'T1H' ? { ...item, obsrValue: 'not-a-number' } : item,
    );

    expect(() => normalizeFixture(withItems(items))).toThrow();
  });

  it('accepts a finite negative air temperature', () => {
    const items = readSuccessFixture().response.body.items.item.map((item) =>
      item.category === 'T1H' ? { ...item, obsrValue: '-12.4' } : item,
    );

    expect(normalizeFixture(withItems(items))).toMatchObject({
      temperatureCelsius: -12.4,
    });
  });

  it.each([
    ['REH', '-0.1'],
    ['REH', '100.1'],
    ['RN1', '-0.1'],
    ['WSD', '-0.1'],
    ['VEC', '-0.1'],
    ['VEC', '360.1'],
  ])('rejects an out-of-range %s value of %s', (category, obsrValue) => {
    const items = readSuccessFixture().response.body.items.item.map((item) =>
      item.category === category ? { ...item, obsrValue } : item,
    );

    expect(() => normalizeFixture(withItems(items))).toThrow();
  });

  it.each(['0', '360'])('accepts the VEC boundary value %s', (obsrValue) => {
    const items = readSuccessFixture().response.body.items.item.map((item) =>
      item.category === 'VEC' ? { ...item, obsrValue } : item,
    );

    expect(normalizeFixture(withItems(items))).toMatchObject({
      windDirectionDegrees: Number(obsrValue),
    });
  });

  it.each([
    ['0', 'none'],
    ['1', 'rain'],
    ['2', 'rain-snow'],
    ['3', 'snow'],
    ['5', 'raindrop'],
    ['6', 'raindrop-snow-flurry'],
    ['7', 'snow-flurry'],
  ] as const)('maps PTY code %s without importing forecast-only semantics', (rawCode, precipitationType) => {
    const items = readSuccessFixture().response.body.items.item.map((item) =>
      item.category === 'PTY' ? { ...item, obsrValue: rawCode } : item,
    );

    expect(normalizeFixture(withItems(items))).toMatchObject({ precipitationType });
  });

  it('rejects a non-success provider result without exposing its raw message', () => {
    const fixture = readSuccessFixture();
    fixture.response.header = {
      resultCode: '03',
      resultMsg: 'RAW_PROVIDER_MESSAGE_MUST_NOT_ESCAPE',
    };
    let thrown: unknown;

    try {
      normalizeFixture(fixture);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain('RAW_PROVIDER_MESSAGE_MUST_NOT_ESCAPE');
  });

  it('rejects a structurally malformed successful result', () => {
    const fixture = readSuccessFixture() as unknown as { response: { body: { items: unknown } } };
    fixture.response.body.items = 'not-an-items-object';

    expect(() => normalizeFixture(fixture)).toThrow();
  });

  it('rejects an item whose grid differs from the selected region', () => {
    const items = readSuccessFixture().response.body.items.item.map((item) =>
      item.category === 'T1H' ? { ...item, nx: item.nx + 1 } : item,
    );

    expect(() => normalizeFixture(withItems(items))).toThrow();
  });

  it('rejects categories that do not share one provider observation timestamp', () => {
    const items = readSuccessFixture().response.body.items.item.map((item) =>
      item.category === 'T1H' ? { ...item, baseTime: '1300' } : item,
    );

    expect(() => normalizeFixture(withItems(items))).toThrow();
  });

  it.each([
    ['baseDate', '20260721'],
    ['baseTime', '1300'],
  ] as const)('rejects a provider %s that differs from the requested slot', (field, value) => {
    const items = readSuccessFixture().response.body.items.item.map((item) => ({ ...item, [field]: value }));

    expect(() => normalizeFixture(withItems(items))).toThrow();
  });

  it('checks the requested slot even when all returned categories are unsupported', () => {
    const vectorOnly = readSuccessFixture()
      .response.body.items.item.filter(({ category }) => category === 'UUU' || category === 'VVV')
      .map((item) => ({ ...item, baseTime: '1300' }));

    expect(() => normalizeFixture(withItems(vectorOnly))).toThrow();
  });
});

describe('KMA HTTPS fetch boundary', () => {
  it('uses only the approved HTTPS endpoint, encoded key, fixed grid and supplied AbortSignal', async () => {
    const fixture = readSuccessFixture();
    const controller = new AbortController();
    let capturedUrl: URL | undefined;
    let capturedSignal: AbortSignal | null | undefined;
    let capturedMethod: string | undefined;
    let capturedRedirect: RequestRedirect | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      capturedSignal = init?.signal;
      capturedMethod = init?.method;
      capturedRedirect = init?.redirect;
      return new Response(JSON.stringify(fixture), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    };

    await expect(
      fetchKmaUltraShortNowcast({
        fetcher,
        region: KMA_WEATHER_REGIONS.seoul,
        serviceKey: 'fixture+/=&service-key',
        signal: controller.signal,
        slot: { baseDate: '20260722', baseTime: '1400' },
      }),
    ).resolves.toEqual(fixture);

    expect(capturedUrl?.protocol).toBe('https:');
    expect(capturedUrl?.host).toBe('apis.data.go.kr');
    expect(capturedUrl?.pathname).toBe('/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst');
    expect(Object.fromEntries(capturedUrl?.searchParams ?? [])).toEqual({
      ServiceKey: 'fixture+/=&service-key',
      base_date: '20260722',
      base_time: '1400',
      dataType: 'JSON',
      numOfRows: '1000',
      nx: '60',
      ny: '127',
      pageNo: '1',
    });
    expect(capturedSignal).toBe(controller.signal);
    expect(capturedMethod).toBe('GET');
    expect(capturedRedirect).toBe('error');
  });

  it('preserves an injected abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('fixture deadline');
    controller.abort(reason);
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      throw init?.signal?.reason;
    };

    await expect(
      fetchKmaUltraShortNowcast({
        fetcher,
        region: KMA_WEATHER_REGIONS.seoul,
        serviceKey: 'fixture-service-key',
        signal: controller.signal,
        slot: { baseDate: '20260722', baseTime: '1400' },
      }),
    ).rejects.toBe(reason);
  });

  it('rejects a non-success HTTP response without reading or exposing its raw body', async () => {
    const rawBody = 'RAW_HTTP_BODY_MUST_NOT_ESCAPE';
    const fetcher = async (): Promise<Response> => new Response(rawBody, { status: 503 });
    let thrown: unknown;

    try {
      await fetchKmaUltraShortNowcast({
        fetcher,
        region: KMA_WEATHER_REGIONS.seoul,
        serviceKey: 'fixture-service-key',
        signal: new AbortController().signal,
        slot: { baseDate: '20260722', baseTime: '1400' },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(rawBody);
  });

  it('rejects an invalid JSON response', async () => {
    const fetcher = async (): Promise<Response> =>
      new Response('{not-json', { headers: { 'content-type': 'application/json' }, status: 200 });

    await expect(
      fetchKmaUltraShortNowcast({
        fetcher,
        region: KMA_WEATHER_REGIONS.seoul,
        serviceKey: 'fixture-service-key',
        signal: new AbortController().signal,
        slot: { baseDate: '20260722', baseTime: '1400' },
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('KMA canonical credential', () => {
  it('reads only DATA_GO_KR_SERVICE_KEY and trims its boundary whitespace', () => {
    expect(
      readKmaWeatherCredential({
        DATA_GO_KR_SERVICE_KEY: '  canonical-fixture-key  ',
        KOREA_EARTHQUAKE_KEY: 'legacy-fixture-key',
      }),
    ).toBe('canonical-fixture-key');
    expect(readKmaWeatherCredential({ KOREA_EARTHQUAKE_KEY: 'legacy-fixture-key' })).toBeUndefined();
    expect(readKmaWeatherCredential({ DATA_GO_KR_SERVICE_KEY: '   ' })).toBeUndefined();
  });
});
