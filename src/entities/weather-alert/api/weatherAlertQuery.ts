import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { weatherAlertDataSchema } from '../model/weatherAlert';

export type WeatherAlertQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const WEATHER_ALERT_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 60_000,
    staleTime: 60_000,
  }),
);

export const weatherAlertQueryOptions = (dependencies: WeatherAlertQueryDependencies = {}) => ({
  ...WEATHER_ALERT_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/weather/alerts', weatherAlertDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['weather-alerts'] as const,
});
