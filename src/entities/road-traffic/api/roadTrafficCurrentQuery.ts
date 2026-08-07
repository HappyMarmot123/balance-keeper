import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import {
  canonicalizeRoadTrafficCurrentBounds,
  type RoadTrafficCurrentBounds,
  roadTrafficCurrentDataSchema,
} from '../model/roadTrafficCurrent';

export type RoadTrafficCurrentQueryDependencies = Readonly<{
  enabled?: boolean;
  fetcher?: JsonFetcher;
}>;

export const ROAD_TRAFFIC_CURRENT_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
  }),
);

const formatCoordinate = (value: number): string => String(Number(value.toFixed(4)));

export const createRoadTrafficCurrentPath = (
  bounds: RoadTrafficCurrentBounds,
): `/api/road-traffic/current?bbox=${string}` => {
  const parsed = canonicalizeRoadTrafficCurrentBounds(bounds);
  return `/api/road-traffic/current?bbox=${[
    parsed.minimumLongitude,
    parsed.minimumLatitude,
    parsed.maximumLongitude,
    parsed.maximumLatitude,
  ]
    .map(formatCoordinate)
    .join(',')}`;
};

const createRequestedBoundsSchema = (bounds: RoadTrafficCurrentBounds) =>
  roadTrafficCurrentDataSchema.refine(
    (snapshot) =>
      snapshot.bounds.minimumLongitude === bounds.minimumLongitude &&
      snapshot.bounds.minimumLatitude === bounds.minimumLatitude &&
      snapshot.bounds.maximumLongitude === bounds.maximumLongitude &&
      snapshot.bounds.maximumLatitude === bounds.maximumLatitude,
    'Road traffic current response bounds must match the requested bounds',
  );

export const roadTrafficCurrentQueryOptions = (
  bounds: RoadTrafficCurrentBounds,
  dependencies: RoadTrafficCurrentQueryDependencies = {},
) => {
  const canonicalBounds = canonicalizeRoadTrafficCurrentBounds(bounds);
  return {
    ...ROAD_TRAFFIC_CURRENT_QUERY_PROFILE,
    enabled: dependencies.enabled ?? false,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJson(createRoadTrafficCurrentPath(canonicalBounds), createRequestedBoundsSchema(canonicalBounds), {
        fetcher: dependencies.fetcher,
        signal,
      }),
    queryKey: [
      'road-traffic',
      'current',
      canonicalBounds.minimumLongitude,
      canonicalBounds.minimumLatitude,
      canonicalBounds.maximumLongitude,
      canonicalBounds.maximumLatitude,
    ] as const,
  };
};
