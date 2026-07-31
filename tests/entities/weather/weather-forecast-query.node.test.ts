// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

type ForecastQueryOptions = Readonly<{
  queryFn: (context: { queryKey: readonly unknown[]; signal: AbortSignal }) => Promise<unknown>;
  queryKey: readonly unknown[];
}>;

type ForecastQueryOptionsFactory = (region: string, dependencies?: { fetcher?: typeof fetch }) => ForecastQueryOptions;

const loadWeatherEntity = async (): Promise<Record<string, unknown>> =>
  (await import('../../../src/entities/weather/index')) as Record<string, unknown>;

const firstForecastAt = Date.parse('2026-07-31T10:00:00+09:00');

const createForecast = (region = 'seoul') => ({
  issuedAt: Date.parse('2026-07-31T08:00:00+09:00'),
  periods: Array.from({ length: 24 }, (_, index) =>
    index === 0
      ? {
          availability: 'available',
          forecastAt: firstForecastAt,
          precipitationAmount: { kind: 'none' },
          precipitationProbabilityPercent: 10,
          precipitationType: 'none',
          relativeHumidityPercent: 65,
          skyCondition: 'clear',
          temperatureCelsius: 28,
          windSpeedMetersPerSecond: 2.1,
        }
      : {
          availability: 'unavailable',
          forecastAt: firstForecastAt + index * 60 * 60_000,
        },
  ),
  region,
});

const createEnvelope = (region = 'seoul') => ({
  data: createForecast(region),
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-07-31T08:05:00+09:00'),
    requestId: 'weather-forecast-query',
    source: 'KMA',
  },
});

describe('weather forecast query options', () => {
  it('builds the bounded Seoul forecast gateway path', async () => {
    const weather = await loadWeatherEntity();
    const createPath = weather.createWeatherForecastPath as ((region: string) => string) | undefined;

    expect(createPath).toBeTypeOf('function');
    if (typeof createPath !== 'function') {
      return;
    }

    expect(createPath('seoul')).toBe('/api/weather/forecast?region=seoul');
  });

  it('owns a forecast-specific key, 15-minute stale time and 30-minute refetch cadence', async () => {
    const weather = await loadWeatherEntity();
    const profile = weather.WEATHER_FORECAST_QUERY_PROFILE as Record<string, unknown> | undefined;
    const createOptions = weather.weatherForecastQueryOptions as ForecastQueryOptionsFactory | undefined;

    expect(profile).toMatchObject({
      refetchInterval: 30 * 60_000,
      refetchIntervalInBackground: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      staleTime: 15 * 60_000,
    });
    expect(createOptions).toBeTypeOf('function');
    if (profile === undefined || typeof createOptions !== 'function') {
      return;
    }

    const options = createOptions('seoul');

    expect(options.queryKey).toEqual(['weather', 'forecast', 'seoul']);
    expect(options).toMatchObject(profile);
  });

  it('uses the injected fetcher and forwards the TanStack AbortSignal', async () => {
    const weather = await loadWeatherEntity();
    const createOptions = weather.weatherForecastQueryOptions as ForecastQueryOptionsFactory | undefined;

    expect(createOptions).toBeTypeOf('function');
    if (typeof createOptions !== 'function') {
      return;
    }

    const envelope = createEnvelope();
    const fetcher = vi.fn(async () => Response.json(envelope));
    const options = createOptions('seoul', { fetcher });
    const signal = new AbortController().signal;

    await expect(options.queryFn({ queryKey: options.queryKey, signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/weather/forecast?region=seoul',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        method: 'GET',
        redirect: 'error',
        signal,
      }),
    );
  });

  it('rejects a successful forecast envelope for a different requested region', async () => {
    const weather = await loadWeatherEntity();
    const createOptions = weather.weatherForecastQueryOptions as ForecastQueryOptionsFactory | undefined;

    expect(createOptions).toBeTypeOf('function');
    if (typeof createOptions !== 'function') {
      return;
    }

    const fetcher = vi.fn(async () => Response.json(createEnvelope('busan')));
    const options = createOptions('seoul', { fetcher });

    await expect(
      options.queryFn({
        queryKey: options.queryKey,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
