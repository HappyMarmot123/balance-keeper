// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

type WeatherAlertQueryOptions = Readonly<{
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
  queryKey: readonly unknown[];
}>;

type WeatherAlertQueryOptionsFactory = (dependencies?: { fetcher?: typeof fetch }) => WeatherAlertQueryOptions;

const loadWeatherAlertEntity = async (): Promise<Record<string, unknown>> =>
  (await import('../../../src/entities/weather-alert/index')) as Record<string, unknown>;

const createEnvelope = (data: unknown = null) => ({
  data,
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-07-31T12:00:00+09:00'),
    requestId: 'weather-alert-query',
    source: 'KMA',
  },
});

describe('weather alert query options', () => {
  it('owns a weather-alert-specific key and one-minute foreground refresh profile', async () => {
    const weatherAlert = await loadWeatherAlertEntity();
    const profile = weatherAlert.WEATHER_ALERT_QUERY_PROFILE as Record<string, unknown> | undefined;
    const createOptions = weatherAlert.weatherAlertQueryOptions as WeatherAlertQueryOptionsFactory | undefined;

    expect(profile).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      staleTime: 60_000,
    });
    expect(createOptions).toBeTypeOf('function');
    if (profile === undefined || typeof createOptions !== 'function') {
      return;
    }

    const options = createOptions();

    expect(options.queryKey).toEqual(['weather-alerts']);
    expect(options).toMatchObject(profile);
  });

  it('requests the fixed gateway path with the injected fetcher and AbortSignal', async () => {
    const weatherAlert = await loadWeatherAlertEntity();
    const createOptions = weatherAlert.weatherAlertQueryOptions as WeatherAlertQueryOptionsFactory | undefined;

    expect(createOptions).toBeTypeOf('function');
    if (typeof createOptions !== 'function') {
      return;
    }

    const envelope = createEnvelope();
    const fetcher = vi.fn(async () => Response.json(envelope));
    const options = createOptions({ fetcher });
    const signal = new AbortController().signal;

    await expect(options.queryFn({ signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/weather/alerts',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        method: 'GET',
        redirect: 'error',
        signal,
      }),
    );
  });

  it('accepts null for no active alerts but rejects non-strict success envelopes', async () => {
    const weatherAlert = await loadWeatherAlertEntity();
    const createOptions = weatherAlert.weatherAlertQueryOptions as WeatherAlertQueryOptionsFactory | undefined;

    expect(createOptions).toBeTypeOf('function');
    if (typeof createOptions !== 'function') {
      return;
    }

    const nullEnvelope = createEnvelope();
    const nullOptions = createOptions({
      fetcher: vi.fn(async () => Response.json(nullEnvelope)),
    });

    await expect(nullOptions.queryFn({ signal: new AbortController().signal })).resolves.toEqual(nullEnvelope);

    const invalidOptions = createOptions({
      fetcher: vi.fn(async () => Response.json({ ...createEnvelope(), unexpected: true })),
    });

    await expect(invalidOptions.queryFn({ signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
