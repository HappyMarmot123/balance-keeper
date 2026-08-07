import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { roadTrafficDetectorDataSchema } from '../model/roadTrafficDetectors';

export type RoadTrafficDetectorQueryDependencies = Readonly<{
  enabled?: boolean;
  fetcher?: JsonFetcher;
}>;

export const ROAD_TRAFFIC_DETECTOR_QUERY_PROFILE = Object.freeze(
  createQueryProfile({ refetchInterval: 5 * 60_000, staleTime: 5 * 60_000 }),
);

export const roadTrafficDetectorQueryOptions = (dependencies: RoadTrafficDetectorQueryDependencies = {}) => ({
  ...ROAD_TRAFFIC_DETECTOR_QUERY_PROFILE,
  enabled: dependencies.enabled ?? false,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/road-traffic/detectors', roadTrafficDetectorDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['road-traffic', 'detectors'] as const,
});
