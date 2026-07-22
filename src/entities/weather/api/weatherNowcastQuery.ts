import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { type WeatherRegionId, weatherNowcastDataSchema } from '../model/weatherNowcast';

export type WeatherNowcastQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const WEATHER_NOWCAST_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  }),
);

export const createWeatherNowcastPath = (region: WeatherRegionId): `/api/weather?region=${WeatherRegionId}` =>
  `/api/weather?region=${region}`;

const createRegionWeatherNowcastDataSchema = (region: WeatherRegionId) =>
  weatherNowcastDataSchema.refine((data) => data === null || data.region === region);

export const weatherNowcastQueryOptions = (
  region: WeatherRegionId,
  dependencies: WeatherNowcastQueryDependencies = {},
) => ({
  ...WEATHER_NOWCAST_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson(createWeatherNowcastPath(region), createRegionWeatherNowcastDataSchema(region), {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['weather', region] as const,
});
