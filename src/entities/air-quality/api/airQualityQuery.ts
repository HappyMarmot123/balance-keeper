import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { type AirQualityRegionId, airQualityDataSchema } from '../model/airQuality';

export type AirQualityQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const AIR_QUALITY_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 30 * 60_000,
    staleTime: 15 * 60_000,
  }),
);

export const createAirQualityPath = (region: AirQualityRegionId): `/api/air?region=${AirQualityRegionId}` =>
  `/api/air?region=${region}`;

const createRegionAirQualityDataSchema = (region: AirQualityRegionId) =>
  airQualityDataSchema.refine((data) => data === null || data.region === region);

export const airQualityQueryOptions = (region: AirQualityRegionId, dependencies: AirQualityQueryDependencies = {}) => ({
  ...AIR_QUALITY_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson(createAirQualityPath(region), createRegionAirQualityDataSchema(region), {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['air-quality', region] as const,
});
