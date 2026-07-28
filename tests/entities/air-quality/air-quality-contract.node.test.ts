// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as airQualityModule from '../../../src/entities/air-quality';

const airQuality = airQualityModule as Record<string, unknown>;
const observedAt = Date.parse('2026-07-27T16:00:00+09:00');

const airQualityFixture = {
  observedAt,
  observedStationCount: 2,
  region: 'seoul',
  stations: [
    {
      address: '서울 가상구 관측로 1',
      latitude: 37.57,
      longitude: 126.98,
      networkName: '도시대기',
      observedAt,
      pm10: { concentration: 31, grade: 'moderate' },
      pm25: { concentration: 15, grade: 'good' },
      providerRegionName: '서울',
      regionId: 'seoul',
      stationName: '북악가상',
    },
    {
      address: '서울 가상구 관측로 2',
      latitude: 37.51,
      longitude: 127.02,
      networkName: '도시대기',
      observedAt,
      pm10: { concentration: 81, grade: 'bad' },
      pm25: { concentration: null, grade: null },
      providerRegionName: '서울',
      regionId: 'seoul',
      stationName: '한강가상',
    },
  ],
  totalStationCount: 2,
} as const;

describe('air-quality regions', () => {
  it('owns the seven approved semantic regions and their AirKorea names', () => {
    expect(airQuality.AIR_QUALITY_REGIONS).toEqual({
      busan: { id: 'busan', name: '부산', providerName: '부산' },
      daegu: { id: 'daegu', name: '대구', providerName: '대구' },
      daejeon: { id: 'daejeon', name: '대전', providerName: '대전' },
      gwangju: { id: 'gwangju', name: '광주', providerName: '광주' },
      incheon: { id: 'incheon', name: '인천', providerName: '인천' },
      jeju: { id: 'jeju', name: '제주', providerName: '제주' },
      seoul: { id: 'seoul', name: '서울', providerName: '서울' },
    });
  });

  it('normalizes approved semantic and Korean aliases without accepting object keys', () => {
    const normalizeAirQualityRegion = airQuality.normalizeAirQualityRegion;

    expect(normalizeAirQualityRegion).toBeTypeOf('function');
    if (typeof normalizeAirQualityRegion !== 'function') {
      return;
    }

    expect(normalizeAirQualityRegion(' SEOUL ')).toBe('seoul');
    expect(normalizeAirQualityRegion(' 서울 ')).toBe('seoul');
    expect(normalizeAirQualityRegion('부산')).toBe('busan');
    expect(normalizeAirQualityRegion('toString')).toBeUndefined();
    expect(normalizeAirQualityRegion('__proto__')).toBeUndefined();
    expect(normalizeAirQualityRegion('')).toBeUndefined();
    expect(normalizeAirQualityRegion('unknown')).toBeUndefined();
  });

  it.each(['seoul', 'busan', 'incheon', 'daegu', 'gwangju', 'daejeon', 'jeju'] as const)(
    'builds the bounded gateway path for %s',
    (region) => {
      const createAirQualityPath = airQuality.createAirQualityPath;

      expect(createAirQualityPath).toBeTypeOf('function');
      if (typeof createAirQualityPath !== 'function') {
        return;
      }

      expect(createAirQualityPath(region)).toBe(`/api/air?region=${region}`);
    },
  );
});

describe('air-quality pollutant grades', () => {
  it.each([
    ['pm10', 0, 'good'],
    ['pm10', 30, 'good'],
    ['pm10', 31, 'moderate'],
    ['pm10', 80, 'moderate'],
    ['pm10', 81, 'bad'],
    ['pm10', 150, 'bad'],
    ['pm10', 151, 'very-bad'],
    ['pm25', 0, 'good'],
    ['pm25', 15, 'good'],
    ['pm25', 16, 'moderate'],
    ['pm25', 35, 'moderate'],
    ['pm25', 36, 'bad'],
    ['pm25', 75, 'bad'],
    ['pm25', 76, 'very-bad'],
  ] as const)('classifies %s concentration %d as %s', (pollutant, concentration, grade) => {
    const classifyAirQualityGrade = airQuality.classifyAirQualityGrade;

    expect(classifyAirQualityGrade).toBeTypeOf('function');
    if (typeof classifyAirQualityGrade !== 'function') {
      return;
    }

    expect(classifyAirQualityGrade(pollutant, concentration)).toBe(grade);
  });

  it.each([-1, 10_000_000_000, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid concentration instead of assigning a reassuring grade: %s',
    (concentration) => {
      const classifyAirQualityGrade = airQuality.classifyAirQualityGrade;

      expect(classifyAirQualityGrade).toBeTypeOf('function');
      if (typeof classifyAirQualityGrade !== 'function') {
        return;
      }

      expect(() => classifyAirQualityGrade('pm10', concentration)).toThrow(RangeError);
    },
  );
});

describe('air-quality transport contract', () => {
  it('accepts one strict regional snapshot or an explicit empty result', () => {
    const schema = airQuality.airQualityDataSchema as
      | { parse: (input: unknown) => unknown; safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(airQualityFixture)).toEqual(airQualityFixture);
    expect(schema.parse(null)).toBeNull();
    expect(
      schema.safeParse({
        ...airQualityFixture,
        providerMessage: 'must not cross the gateway boundary',
      }).success,
    ).toBe(false);
  });

  it.each([
    { concentration: null, grade: 'good' },
    { concentration: 31, grade: null },
    { concentration: 31, grade: 'good' },
    { concentration: 10_000_000_000, grade: 'very-bad' },
  ])('rejects an impossible PM10 concentration and grade pair: %j', (pm10) => {
    const schema = airQuality.airQualityDataSchema as
      | { safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(
      schema.safeParse({
        ...airQualityFixture,
        stations: [{ ...airQualityFixture.stations[0], pm10 }, airQualityFixture.stations[1]],
      }).success,
    ).toBe(false);
  });

  it.each([
    { observedAt: observedAt - 60_000 },
    { observedStationCount: 1 },
    { totalStationCount: 3 },
    {
      stations: [{ ...airQualityFixture.stations[0], providerRegionName: '부산' }, airQualityFixture.stations[1]],
    },
    {
      stations: [{ ...airQualityFixture.stations[0], regionId: 'busan' }, airQualityFixture.stations[1]],
    },
  ])('rejects inconsistent snapshot metadata: %j', (change) => {
    const schema = airQuality.airQualityDataSchema as
      | { safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.safeParse({ ...airQualityFixture, ...change }).success).toBe(false);
  });
});

describe('air-quality summary', () => {
  it('selects the highest observed station with explicit pollutant coverage', () => {
    const selectAirQualitySummary = airQuality.selectAirQualitySummary;

    expect(selectAirQualitySummary).toBeTypeOf('function');
    if (typeof selectAirQualitySummary !== 'function') {
      return;
    }

    expect(selectAirQualitySummary(airQualityFixture, 'pm10')).toEqual({
      highest: {
        concentration: 81,
        grade: 'bad',
        stationName: '한강가상',
      },
      observedStationCount: 2,
      pollutant: 'pm10',
      totalStationCount: 2,
    });
    expect(selectAirQualitySummary(airQualityFixture, 'pm25')).toEqual({
      highest: {
        concentration: 15,
        grade: 'good',
        stationName: '북악가상',
      },
      observedStationCount: 1,
      pollutant: 'pm25',
      totalStationCount: 2,
    });
  });

  it('breaks equal-concentration ties by station name instead of provider order', () => {
    const selectAirQualitySummary = airQuality.selectAirQualitySummary;

    expect(selectAirQualitySummary).toBeTypeOf('function');
    if (typeof selectAirQualitySummary !== 'function') {
      return;
    }

    const tiedSnapshot = {
      ...airQualityFixture,
      stations: [
        {
          ...airQualityFixture.stations[0],
          pm10: { concentration: 81, grade: 'bad' },
          stationName: '후순위가상',
        },
        {
          ...airQualityFixture.stations[1],
          stationName: '가나다가상',
        },
      ],
    } as const;

    expect(selectAirQualitySummary(tiedSnapshot, 'pm10').highest).toEqual({
      concentration: 81,
      grade: 'bad',
      stationName: '가나다가상',
    });
  });
});

describe('air-quality query options', () => {
  it('owns the canonical region key and approved foreground cadence', () => {
    const airQualityQueryOptions = airQuality.airQualityQueryOptions;
    const profile = airQuality.AIR_QUALITY_QUERY_PROFILE;

    expect(airQualityQueryOptions).toBeTypeOf('function');
    expect(profile).toBeDefined();
    if (typeof airQualityQueryOptions !== 'function' || profile === undefined) {
      return;
    }

    const options = airQualityQueryOptions('busan') as Record<string, unknown>;

    expect(options.queryKey).toEqual(['air-quality', 'busan']);
    expect(profile).toMatchObject({
      refetchInterval: 30 * 60_000,
      refetchIntervalInBackground: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      staleTime: 15 * 60_000,
    });
    expect(options).toMatchObject(profile as Record<string, unknown>);
  });

  it('loads only the canonical region path and returns the validated envelope', async () => {
    const envelope = {
      data: airQualityFixture,
      meta: {
        cache: 'MISS',
        fetchedAt: Date.parse('2026-07-27T16:09:00+09:00'),
        requestId: 'air-quality-request-1',
        source: 'AirKorea',
      },
    } as const;
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(envelope), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    );
    const airQualityQueryOptions = airQuality.airQualityQueryOptions;

    expect(airQualityQueryOptions).toBeTypeOf('function');
    if (typeof airQualityQueryOptions !== 'function') {
      return;
    }

    const options = airQualityQueryOptions('seoul', { fetcher }) as {
      queryFn?: (context: { queryKey: readonly unknown[]; signal: AbortSignal }) => Promise<unknown>;
      queryKey: readonly unknown[];
    };

    expect(options.queryFn).toBeTypeOf('function');
    if (typeof options.queryFn !== 'function') {
      return;
    }

    const signal = new AbortController().signal;
    await expect(options.queryFn({ queryKey: options.queryKey, signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/air?region=seoul',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        method: 'GET',
        redirect: 'error',
        signal,
      }),
    );
  });

  it('rejects a successful envelope that belongs to a different requested region', async () => {
    const busanSnapshot = {
      ...airQualityFixture,
      region: 'busan',
      stations: airQualityFixture.stations.map((station) => ({
        ...station,
        providerRegionName: '부산',
        regionId: 'busan',
      })),
    };
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: busanSnapshot,
            meta: {
              cache: 'MISS',
              fetchedAt: Date.parse('2026-07-27T16:09:00+09:00'),
              requestId: 'air-quality-request-2',
              source: 'AirKorea',
            },
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        ),
      ),
    );
    const airQualityQueryOptions = airQuality.airQualityQueryOptions;

    expect(airQualityQueryOptions).toBeTypeOf('function');
    if (typeof airQualityQueryOptions !== 'function') {
      return;
    }

    const options = airQualityQueryOptions('seoul', { fetcher }) as {
      queryFn?: (context: { queryKey: readonly unknown[]; signal: AbortSignal }) => Promise<unknown>;
      queryKey: readonly unknown[];
    };

    expect(options.queryFn).toBeTypeOf('function');
    if (typeof options.queryFn !== 'function') {
      return;
    }

    await expect(
      options.queryFn({
        queryKey: options.queryKey,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('forwards TanStack cancellation to the gateway request', async () => {
    let receivedSignal: AbortSignal | null = null;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      receivedSignal = init?.signal instanceof AbortSignal ? init.signal : null;

      return new Promise<Response>((_resolve, reject) => {
        const rejectAsAborted = () => reject(new DOMException('cancelled', 'AbortError'));

        if (init?.signal?.aborted) {
          rejectAsAborted();
          return;
        }

        init?.signal?.addEventListener('abort', rejectAsAborted, {
          once: true,
        });
      });
    });
    const controller = new AbortController();
    const options = airQualityModule.airQualityQueryOptions('seoul', {
      fetcher,
    });

    const pending = options.queryFn({
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(receivedSignal).toBe(controller.signal);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
