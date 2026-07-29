// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as airKoreaModule from '../../../src/server/providers/airkorea';

const measurementFixturePath = resolve(import.meta.dirname, '../../fixtures/airkorea/measurement-success.json');
const stationFixturePath = resolve(import.meta.dirname, '../../fixtures/airkorea/station-directory-success.json');
const readMeasurementFixture = (): unknown => JSON.parse(readFileSync(measurementFixturePath, 'utf8')) as unknown;
const readStationFixture = (): unknown => JSON.parse(readFileSync(stationFixturePath, 'utf8')) as unknown;
const airKorea = airKoreaModule as Record<string, unknown>;
const syntheticConfig = {
  measurementBaseUrl: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
  measurementKey: 'synthetic-data-go-key',
  stationBaseUrl: 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc',
  stationKey: 'synthetic-data-go-key',
} as const;

describe('AirKorea regional normalization', () => {
  it('joins measurement and station metadata into the strict public snapshot', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const snapshot = normalizeAirKoreaSnapshot(readMeasurementFixture(), readStationFixture(), 'seoul');

    expect(snapshot).toMatchObject({
      observedAt: Date.parse('2026-06-15T09:00:00+09:00'),
      observedStationCount: 4,
      region: 'seoul',
      totalStationCount: 5,
    });
    expect(snapshot.stations).toHaveLength(5);
    expect(snapshot.stations[0]).toEqual({
      address: '서울특별시 합성구 테스트로 1',
      latitude: 37.55,
      longitude: 126.98,
      networkName: '도시대기',
      observedAt: Date.parse('2026-06-15T09:00:00+09:00'),
      pm10: { concentration: 0, grade: 'good' },
      pm25: { concentration: 15, grade: 'good' },
      providerRegionName: '서울',
      regionId: 'seoul',
      stationName: '합성측정소-A',
    });
    expect(snapshot.stations[3]).toMatchObject({
      pm10: { concentration: 151, grade: 'very-bad' },
      pm25: { concentration: 76, grade: 'very-bad' },
    });
    expect(snapshot.stations[4]).toMatchObject({
      pm10: { concentration: null, grade: null },
      pm25: { concentration: null, grade: null },
    });
  });

  it('rejects a response that does not echo the bounded 100-row page contract', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const measurement = readMeasurementFixture() as {
      response: { body: { numOfRows: number } };
    };
    measurement.response.body.numOfRows = 99;

    expect(() => normalizeAirKoreaSnapshot(measurement, readStationFixture(), 'seoul')).toThrow(/pagination/i);
  });

  it.each([
    ['measurement page number', 'pageNo', 2],
    ['measurement total count limit', 'totalCount', 101],
    ['measurement item-count mismatch', 'totalCount', 4],
  ] as const)('rejects an invalid %s', (_case, field, value) => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const measurement = readMeasurementFixture() as {
      response: {
        body: {
          pageNo: number;
          totalCount: number;
        };
      };
    };
    measurement.response.body[field] = value;

    expect(() => normalizeAirKoreaSnapshot(measurement, readStationFixture(), 'seoul')).toThrow(/pagination/i);
  });

  it('applies the same one-page pagination contract to the station directory', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const directory = readStationFixture() as {
      response: {
        body: { pageNo: number };
      };
    };
    directory.response.body.pageNo = 2;

    expect(() => normalizeAirKoreaSnapshot(readMeasurementFixture(), directory, 'seoul')).toThrow(/pagination/i);
  });

  it('rejects coordinates whose dmX/dmY axes are swapped outside Korean bounds', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const directory = readStationFixture() as {
      response: {
        body: {
          items: Array<{ dmX: string; dmY: string }>;
        };
      };
    };
    const station = directory.response.body.items[0];
    if (station === undefined) {
      throw new TypeError('Synthetic station fixture must contain one item');
    }
    [station.dmX, station.dmY] = [station.dmY, station.dmX];

    expect(() => normalizeAirKoreaSnapshot(readMeasurementFixture(), directory, 'seoul')).toThrow(/latitude|bounds/i);
  });

  it('rejects an impossible KST observation calendar value', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const measurement = readMeasurementFixture() as {
      response: {
        body: {
          items: Array<{ dataTime: string }>;
        };
      };
    };
    const item = measurement.response.body.items[0];
    if (item === undefined) {
      throw new TypeError('Synthetic measurement fixture must contain one item');
    }
    item.dataTime = '2026-02-30 09:00';

    expect(() => normalizeAirKoreaSnapshot(measurement, readStationFixture(), 'seoul')).toThrow(/timestamp/i);
  });

  it('rejects a measurement whose normalized station-network pair has no metadata', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const directory = readStationFixture() as {
      response: {
        body: {
          items: Array<{ stationName: string }>;
        };
      };
    };
    const station = directory.response.body.items[0];
    if (station === undefined) {
      throw new TypeError('Synthetic station fixture must contain one item');
    }
    station.stationName = '합성-불일치-측정소';

    expect(() => normalizeAirKoreaSnapshot(readMeasurementFixture(), directory, 'seoul')).toThrow(
      /metadata is missing/i,
    );
  });

  it('rejects ambiguous station metadata after whitespace normalization', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const directory = readStationFixture() as {
      response: {
        body: {
          items: Array<{ mangName: string; stationName: string }>;
          totalCount: number;
        };
      };
    };
    const station = directory.response.body.items[0];
    if (station === undefined) {
      throw new TypeError('Synthetic station fixture must contain one item');
    }
    directory.response.body.items.push({
      ...station,
      mangName: ` ${station.mangName} `,
      stationName: ` ${station.stationName} `,
    });
    directory.response.body.totalCount = directory.response.body.items.length;

    expect(() => normalizeAirKoreaSnapshot(readMeasurementFixture(), directory, 'seoul')).toThrow(/ambiguous station/i);
  });

  it('validates station-directory ambiguity before accepting a normal empty measurement page', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const measurement = readMeasurementFixture() as {
      response: {
        body: { items: unknown[]; totalCount: number };
      };
    };
    measurement.response.body.items = [];
    measurement.response.body.totalCount = 0;
    const directory = readStationFixture() as {
      response: {
        body: {
          items: Array<Record<string, unknown>>;
          totalCount: number;
        };
      };
    };
    const firstStation = directory.response.body.items[0];
    if (firstStation === undefined) {
      throw new TypeError('Synthetic station fixture must contain one item');
    }
    directory.response.body.items.push(structuredClone(firstStation));
    directory.response.body.totalCount = directory.response.body.items.length;

    expect(() => normalizeAirKoreaSnapshot(measurement, directory, 'seoul')).toThrow(/ambiguous station/i);
  });

  it('validates coordinates on an extra directory row that has no current measurement', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const directory = readStationFixture() as {
      response: {
        body: {
          items: Array<Record<string, unknown>>;
          totalCount: number;
        };
      };
    };
    directory.response.body.items.push({
      addr: '서울특별시 합성구 테스트로 99',
      dmX: '126.97',
      dmY: '37.54',
      item: 'PM10, PM2.5',
      mangName: '도시대기',
      stationName: '합성측정소-미관측',
      year: '2025',
    });
    directory.response.body.totalCount = directory.response.body.items.length;

    expect(() => normalizeAirKoreaSnapshot(readMeasurementFixture(), directory, 'seoul')).toThrow(
      /outside Korea bounds/i,
    );
  });

  it('rejects station metadata whose address is outside the selected provider region', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const directory = readStationFixture() as {
      response: {
        body: {
          items: Array<{ addr: string }>;
        };
      };
    };
    const firstStation = directory.response.body.items[0];
    if (firstStation === undefined) {
      throw new TypeError('Synthetic station fixture must contain one item');
    }
    firstStation.addr = '부산광역시 합성구 테스트로 1';

    expect(() => normalizeAirKoreaSnapshot(readMeasurementFixture(), directory, 'seoul')).toThrow(/region/i);
  });

  it('rejects a logical provider failure without exposing resultMsg', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const rawMarker = 'RAW_LOGICAL_MESSAGE_MUST_NOT_ESCAPE';
    const measurement = readMeasurementFixture() as {
      response: {
        header: { resultCode: string; resultMsg: string };
      };
    };
    measurement.response.header = {
      resultCode: '03',
      resultMsg: rawMarker,
    };
    let thrown: unknown;

    try {
      normalizeAirKoreaSnapshot(measurement, readStationFixture(), 'seoul');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain(rawMarker);
  });

  it('rejects a station-directory logical failure without exposing resultMsg', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const rawMarker = 'RAW_STATION_LOGICAL_MESSAGE_MUST_NOT_ESCAPE';
    const directory = readStationFixture() as {
      response: {
        header: { resultCode: string; resultMsg: string };
      };
    };
    directory.response.header = {
      resultCode: '03',
      resultMsg: rawMarker,
    };
    let thrown: unknown;

    try {
      normalizeAirKoreaSnapshot(readMeasurementFixture(), directory, 'seoul');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain(rawMarker);
  });

  it('rejects a malformed success schema without exposing raw fields', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const rawMarker = 'RAW_SCHEMA_FIELD_MUST_NOT_ESCAPE';
    const measurement = readMeasurementFixture() as {
      response: {
        body: { items: unknown };
      };
    };
    measurement.response.body.items = rawMarker;
    let thrown: unknown;

    try {
      normalizeAirKoreaSnapshot(measurement, readStationFixture(), 'seoul');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain(rawMarker);
  });

  it('rejects provider fields outside the documented ten-character PM contract', () => {
    const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

    expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
    if (typeof normalizeAirKoreaSnapshot !== 'function') {
      return;
    }

    const measurement = readMeasurementFixture() as {
      response: {
        body: {
          items: Array<{ pm10Value: string }>;
        };
      };
    };
    const firstItem = measurement.response.body.items[0];
    if (firstItem === undefined) {
      throw new TypeError('Synthetic AirKorea fixture must contain one item');
    }
    firstItem.pm10Value = '10000000000';

    expect(() => normalizeAirKoreaSnapshot(measurement, readStationFixture(), 'seoul')).toThrow();
  });

  it.each(['measurement', 'station directory'] as const)(
    'rejects an undocumented scalar field in the strict %s item schema',
    (provider) => {
      const normalizeAirKoreaSnapshot = airKorea.normalizeAirKoreaSnapshot;

      expect(normalizeAirKoreaSnapshot).toBeTypeOf('function');
      if (typeof normalizeAirKoreaSnapshot !== 'function') {
        return;
      }

      const measurement = readMeasurementFixture() as {
        response: {
          body: {
            items: Array<Record<string, unknown>>;
          };
        };
      };
      const station = readStationFixture() as {
        response: {
          body: {
            items: Array<Record<string, unknown>>;
          };
        };
      };
      const target = provider === 'measurement' ? measurement.response.body.items[0] : station.response.body.items[0];
      if (target === undefined) {
        throw new TypeError('Synthetic AirKorea fixture must contain one item');
      }
      target.undocumentedScalar = 'must be rejected';

      expect(() => normalizeAirKoreaSnapshot(measurement, station, 'seoul')).toThrow();
    },
  );
});

describe('AirKorea server configuration', () => {
  const validEnvironment = {
    DATA_GO_KR_SERVICE_KEY: 'synthetic-data-go-key',
    KOREA_AIR_QUALITY_BASE_URL: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
    KOREA_AIR_STATION_BASE_URL: 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc',
  } as const;

  it('uses one canonical data.go.kr key with the two approved service-family bases', () => {
    const readAirKoreaConfig = airKorea.readAirKoreaConfig;

    expect(readAirKoreaConfig).toBeTypeOf('function');
    if (typeof readAirKoreaConfig !== 'function') {
      return;
    }

    expect(
      readAirKoreaConfig({
        DATA_GO_KR_SERVICE_KEY: '  synthetic-data-go-key  ',
        KOREA_AIR_QUALITY_BASE_URL: '  https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/  ',
        KOREA_AIR_QUALITY_EXPIRES_AT: 'ignored-by-t11',
        KOREA_AIR_STATION_BASE_URL: ' https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc ',
        KOREA_AIR_STATION_EXPIRES_AT: 'ignored-by-t11',
      }),
    ).toEqual({
      measurementBaseUrl: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
      measurementKey: 'synthetic-data-go-key',
      stationBaseUrl: 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc',
      stationKey: 'synthetic-data-go-key',
    });
  });

  it.each([
    ['missing canonical key', { ...validEnvironment, DATA_GO_KR_SERVICE_KEY: '' }],
    [
      'legacy provider-specific key aliases',
      {
        KOREA_AIR_QUALITY_BASE_URL: validEnvironment.KOREA_AIR_QUALITY_BASE_URL,
        KOREA_AIR_QUALITY_KEY: 'legacy-key',
        KOREA_AIR_STATION_BASE_URL: validEnvironment.KOREA_AIR_STATION_BASE_URL,
        KOREA_AIR_STATION_KEY: 'legacy-key',
        KOREA_EARTHQUAKE_KEY: 'legacy-key',
      },
    ],
    [
      'insecure measurement protocol',
      {
        ...validEnvironment,
        KOREA_AIR_QUALITY_BASE_URL: 'http://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
      },
    ],
    [
      'unapproved station host',
      {
        ...validEnvironment,
        KOREA_AIR_STATION_BASE_URL: 'https://example.test/B552584/MsrstnInfoInqireSvc',
      },
    ],
    [
      'swapped service family',
      {
        ...validEnvironment,
        KOREA_AIR_STATION_BASE_URL: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
      },
    ],
    [
      'operation-bearing base',
      {
        ...validEnvironment,
        KOREA_AIR_QUALITY_BASE_URL: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty',
      },
    ],
    [
      'query-bearing base',
      {
        ...validEnvironment,
        KOREA_AIR_QUALITY_BASE_URL: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc?serviceKey=unsafe',
      },
    ],
    [
      'non-default port',
      {
        ...validEnvironment,
        KOREA_AIR_STATION_BASE_URL: 'https://apis.data.go.kr:444/B552584/MsrstnInfoInqireSvc',
      },
    ],
  ])('rejects %s instead of guessing a provider configuration', (_case, environment) => {
    const readAirKoreaConfig = airKorea.readAirKoreaConfig;

    expect(readAirKoreaConfig).toBeTypeOf('function');
    if (typeof readAirKoreaConfig !== 'function') {
      return;
    }

    expect(readAirKoreaConfig(environment)).toBeUndefined();
  });
});

describe('AirKorea HTTPS transport', () => {
  it('fetches both service operations with one canonical key and one shared signal', async () => {
    const fetchAirKoreaInputs = airKorea.fetchAirKoreaInputs;
    const signal = new AbortController().signal;
    const requests: Array<{ init?: RequestInit; url: URL }> = [];
    const measurementFixture = readMeasurementFixture();
    const stationFixture = readStationFixture();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      requests.push({ init, url });
      const payload = url.pathname.endsWith('/getCtprvnRltmMesureDnsty') ? measurementFixture : stationFixture;
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    expect(fetchAirKoreaInputs).toBeTypeOf('function');
    if (typeof fetchAirKoreaInputs !== 'function') {
      return;
    }

    await expect(
      fetchAirKoreaInputs({
        config: {
          measurementBaseUrl: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
          measurementKey: 'synthetic%2Bdata%2Fgo%3D',
          stationBaseUrl: 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc',
          stationKey: 'synthetic%2Bdata%2Fgo%3D',
        },
        fetcher,
        providerRegionName: '서울',
        signal,
      }),
    ).resolves.toEqual({
      measurement: measurementFixture,
      stationDirectory: stationFixture,
    });

    expect(requests).toHaveLength(2);
    const measurementRequest = requests.find(({ url }) => url.pathname.endsWith('/getCtprvnRltmMesureDnsty'));
    const stationRequest = requests.find(({ url }) => url.pathname.endsWith('/getMsrstnList'));
    expect(measurementRequest?.url.protocol).toBe('https:');
    expect(measurementRequest?.url.host).toBe('apis.data.go.kr');
    expect(Object.fromEntries(measurementRequest?.url.searchParams ?? [])).toEqual({
      numOfRows: '100',
      pageNo: '1',
      returnType: 'json',
      serviceKey: 'synthetic+data/go=',
      sidoName: '서울',
      ver: '1.5',
    });
    expect(Object.fromEntries(stationRequest?.url.searchParams ?? [])).toEqual({
      addr: '서울',
      numOfRows: '100',
      pageNo: '1',
      returnType: 'json',
      serviceKey: 'synthetic+data/go=',
    });
    for (const request of requests) {
      expect(request.init).toMatchObject({
        method: 'GET',
        redirect: 'error',
        signal,
      });
    }
  });

  it.each([
    [
      'HTTP failure',
      'RAW_HTTP_BODY_MUST_NOT_ESCAPE',
      async (rawMarker: string) => new Response(rawMarker, { status: 503 }),
    ],
    [
      'non-JSON success',
      'RAW_NON_JSON_BODY_MUST_NOT_ESCAPE',
      async (rawMarker: string) =>
        new Response(`{${rawMarker}`, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    ],
    [
      'network failure',
      'RAW_NETWORK_ERROR_MUST_NOT_ESCAPE',
      async (rawMarker: string): Promise<Response> => {
        throw new TypeError(rawMarker);
      },
    ],
  ] as const)('rejects a provider %s without exposing its raw detail', async (_case, rawMarker, createResponse) => {
    const fetchAirKoreaInputs = airKorea.fetchAirKoreaInputs;

    expect(fetchAirKoreaInputs).toBeTypeOf('function');
    if (typeof fetchAirKoreaInputs !== 'function') {
      return;
    }

    let thrown: unknown;
    try {
      await fetchAirKoreaInputs({
        config: syntheticConfig,
        fetcher: async () => createResponse(rawMarker),
        providerRegionName: '서울',
        signal: new AbortController().signal,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain(rawMarker);
  });

  it('preserves an already-aborted signal reason without starting either fetch', async () => {
    const fetchAirKoreaInputs = airKorea.fetchAirKoreaInputs;

    expect(fetchAirKoreaInputs).toBeTypeOf('function');
    if (typeof fetchAirKoreaInputs !== 'function') {
      return;
    }

    const controller = new AbortController();
    const reason = new Error('synthetic request deadline');
    controller.abort(reason);
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));

    await expect(
      fetchAirKoreaInputs({
        config: syntheticConfig,
        fetcher,
        providerRegionName: '서울',
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails the joined request safely when only the station-directory HTTP call fails', async () => {
    const fetchAirKoreaInputs = airKorea.fetchAirKoreaInputs;

    expect(fetchAirKoreaInputs).toBeTypeOf('function');
    if (typeof fetchAirKoreaInputs !== 'function') {
      return;
    }

    const rawMarker = 'RAW_STATION_HTTP_BODY_MUST_NOT_ESCAPE';
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return url.pathname.endsWith('/getMsrstnList')
        ? new Response(rawMarker, { status: 503 })
        : new Response(JSON.stringify(readMeasurementFixture()), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          });
    });
    let thrown: unknown;

    try {
      await fetchAirKoreaInputs({
        config: syntheticConfig,
        fetcher,
        providerRegionName: '서울',
        signal: new AbortController().signal,
      });
    } catch (error) {
      thrown = error;
    }

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(thrown).toBeInstanceOf(Error);
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain(rawMarker);
  });
});
