import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { weatherForecastDataSchema } from '../model/weatherForecast';
import type { WeatherRegionId } from '../model/weatherNowcast';

export type WeatherForecastQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const WEATHER_FORECAST_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 30 * 60_000,
    staleTime: 15 * 60_000,
  }),
);

export const createWeatherForecastPath = (region: WeatherRegionId): `/api/weather/forecast?region=${WeatherRegionId}` =>
  `/api/weather/forecast?region=${region}`;

const createRegionWeatherForecastDataSchema = (region: WeatherRegionId) =>
  weatherForecastDataSchema.refine((data) => data === null || data.region === region);

export const weatherForecastQueryOptions = (
  region: WeatherRegionId,
  dependencies: WeatherForecastQueryDependencies = {},
) => ({
  ...WEATHER_FORECAST_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson(createWeatherForecastPath(region), createRegionWeatherForecastDataSchema(region), {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['weather', 'forecast', region] as const,
});
