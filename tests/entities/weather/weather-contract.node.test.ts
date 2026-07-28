// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  createWeatherNowcastPath,
  WEATHER_NOWCAST_QUERY_PROFILE,
  WEATHER_REGIONS,
  weatherNowcastDataSchema,
  weatherNowcastQueryOptions,
} from '../../../src/entities/weather';

const observedAt = Date.parse('2026-07-22T14:00:00+09:00');

const weatherNowcastFixture = {
  observedAt,
  precipitationLastHourMm: 0,
  precipitationType: 'none',
  region: 'seoul',
  relativeHumidityPercent: 72,
  temperatureCelsius: 27.4,
  windDirectionDegrees: 250,
  windSpeedMetersPerSecond: 2.3,
} as const;

const successEnvelopeFixture = {
  data: weatherNowcastFixture,
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-07-22T14:09:00+09:00'),
    requestId: 'weather-request-1',
    source: 'KMA',
  },
} as const;

describe('weather nowcast transport contract', () => {
  it('accepts one strict weather observation or an explicit empty result', () => {
    expect(weatherNowcastDataSchema.parse(weatherNowcastFixture)).toEqual(weatherNowcastFixture);
    expect(weatherNowcastDataSchema.parse(null)).toBeNull();
    expect(
      weatherNowcastDataSchema.safeParse({
        ...weatherNowcastFixture,
        providerMessage: 'must not cross the gateway boundary',
      }).success,
    ).toBe(false);
  });

  it.each([
    'temperatureCelsius',
    'relativeHumidityPercent',
    'precipitationLastHourMm',
    'precipitationType',
    'windSpeedMetersPerSecond',
    'windDirectionDegrees',
  ] as const)('keeps a missing %s measurement explicitly nullable', (field) => {
    const parsed = weatherNowcastDataSchema.parse({
      ...weatherNowcastFixture,
      [field]: null,
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.[field]).toBeNull();
  });

  it.each(['none', 'rain', 'rain-snow', 'snow', 'raindrop', 'raindrop-snow-flurry', 'snow-flurry'] as const)(
    'accepts the documented ultra-short nowcast precipitation type %s',
    (precipitationType) => {
      expect(
        weatherNowcastDataSchema.safeParse({
          ...weatherNowcastFixture,
          precipitationType,
        }).success,
      ).toBe(true);
    },
  );

  it('rejects an unsupported precipitation type instead of guessing', () => {
    expect(
      weatherNowcastDataSchema.safeParse({
        ...weatherNowcastFixture,
        precipitationType: 'shower',
      }).success,
    ).toBe(false);
  });

  it('rejects an observation epoch that cannot be rendered as a JavaScript Date', () => {
    expect(
      weatherNowcastDataSchema.safeParse({
        ...weatherNowcastFixture,
        observedAt: 8_640_000_000_000_001,
      }).success,
    ).toBe(false);
  });
});

describe('weather regions', () => {
  it('owns the seven approved semantic regions and their canonical KMA grids', () => {
    expect(WEATHER_REGIONS).toEqual({
      busan: { id: 'busan', name: '부산', nx: 98, ny: 76 },
      daegu: { id: 'daegu', name: '대구', nx: 89, ny: 90 },
      daejeon: { id: 'daejeon', name: '대전', nx: 67, ny: 100 },
      gwangju: { id: 'gwangju', name: '광주', nx: 58, ny: 74 },
      incheon: { id: 'incheon', name: '인천', nx: 55, ny: 124 },
      jeju: { id: 'jeju', name: '제주', nx: 52, ny: 38 },
      seoul: { id: 'seoul', name: '서울', nx: 60, ny: 127 },
    });
  });

  it.each(['seoul', 'busan', 'incheon', 'daegu', 'gwangju', 'daejeon', 'jeju'] as const)(
    'builds the bounded gateway path for %s without exposing grid coordinates',
    (region) => {
      expect(createWeatherNowcastPath(region)).toBe(`/api/weather?region=${region}`);
    },
  );
});

describe('weather nowcast query options', () => {
  it('owns the region key, five-minute stale time and ten-minute foreground cadence', () => {
    const options = weatherNowcastQueryOptions('busan');

    expect(options.queryKey).toEqual(['weather', 'busan']);
    expect(WEATHER_NOWCAST_QUERY_PROFILE).toMatchObject({
      refetchInterval: 10 * 60_000,
      refetchIntervalInBackground: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      staleTime: 5 * 60_000,
    });
    expect(options).toMatchObject(WEATHER_NOWCAST_QUERY_PROFILE);
  });

  it('loads only the normalized region path and returns the validated envelope', async () => {
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(successEnvelopeFixture), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    );
    const options = weatherNowcastQueryOptions('seoul', { fetcher });
    const queryFn = options.queryFn;

    expect(queryFn).toBeTypeOf('function');
    if (typeof queryFn !== 'function') {
      throw new TypeError('weather queryFn must be callable');
    }

    const signal = new AbortController().signal;
    const result = await queryFn({ queryKey: options.queryKey, signal } as never);

    expect(fetcher).toHaveBeenCalledWith(
      '/api/weather?region=seoul',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        method: 'GET',
        redirect: 'error',
        signal,
      }),
    );
    expect(result).toEqual(successEnvelopeFixture);
  });

  it('rejects a successful envelope whose observation belongs to a different requested region', async () => {
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...successEnvelopeFixture,
            data: { ...weatherNowcastFixture, region: 'busan' },
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        ),
      ),
    );
    const options = weatherNowcastQueryOptions('seoul', { fetcher });
    const queryFn = options.queryFn;

    expect(queryFn).toBeTypeOf('function');
    if (typeof queryFn !== 'function') {
      throw new TypeError('weather queryFn must be callable');
    }

    await expect(
      queryFn({ queryKey: options.queryKey, signal: new AbortController().signal } as never),
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

        init?.signal?.addEventListener('abort', rejectAsAborted, { once: true });
      });
    });
    const controller = new AbortController();
    const options = weatherNowcastQueryOptions('jeju', { fetcher });
    const queryFn = options.queryFn;

    expect(queryFn).toBeTypeOf('function');
    if (typeof queryFn !== 'function') {
      throw new TypeError('weather queryFn must be callable');
    }

    const pending = queryFn({ queryKey: options.queryKey, signal: controller.signal } as never);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(receivedSignal).toBe(controller.signal);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
