import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { roadTrafficForecastDataSchema } from '../model/roadTrafficForecast';

export type RoadTrafficForecastQueryDependencies = Readonly<{
  enabled?: boolean;
  fetcher?: JsonFetcher;
}>;

export const ROAD_TRAFFIC_FORECAST_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 30 * 60_000,
    staleTime: 30 * 60_000,
  }),
);

export const roadTrafficForecastQueryOptions = (dependencies: RoadTrafficForecastQueryDependencies = {}) => ({
  ...ROAD_TRAFFIC_FORECAST_QUERY_PROFILE,
  enabled: dependencies.enabled ?? false,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/road-traffic/forecast', roadTrafficForecastDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['road-traffic', 'forecast'] as const,
});
