import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { type CctvBounds, canonicalizeCctvBounds, cctvDataSchema } from '../model/cctv';

export type CctvListQueryDependencies = Readonly<{
  enabled?: boolean;
  fetcher?: JsonFetcher;
}>;

export const CCTV_LIST_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 10 * 60_000,
    staleTime: 10 * 60_000,
  }),
);

const formatCoordinate = (value: number): string => String(Number(value.toFixed(4)));

export const createCctvListPath = (bounds: CctvBounds): `/api/cctv/list?bbox=${string}` => {
  const parsed = canonicalizeCctvBounds(bounds);
  return `/api/cctv/list?bbox=${[
    parsed.minimumLongitude,
    parsed.minimumLatitude,
    parsed.maximumLongitude,
    parsed.maximumLatitude,
  ]
    .map(formatCoordinate)
    .join(',')}`;
};

const createRequestedBoundsSchema = (bounds: CctvBounds) =>
  cctvDataSchema.refine(
    (snapshot) =>
      snapshot.bounds.minimumLongitude === bounds.minimumLongitude &&
      snapshot.bounds.minimumLatitude === bounds.minimumLatitude &&
      snapshot.bounds.maximumLongitude === bounds.maximumLongitude &&
      snapshot.bounds.maximumLatitude === bounds.maximumLatitude,
    'CCTV response bounds must match the requested bounds',
  );

export const cctvListQueryOptions = (bounds: CctvBounds, dependencies: CctvListQueryDependencies = {}) => {
  const canonicalBounds = canonicalizeCctvBounds(bounds);
  return {
    ...CCTV_LIST_QUERY_PROFILE,
    enabled: dependencies.enabled ?? false,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJson(createCctvListPath(canonicalBounds), createRequestedBoundsSchema(canonicalBounds), {
        fetcher: dependencies.fetcher,
        signal,
      }),
    queryKey: [
      'cctv-list',
      canonicalBounds.minimumLongitude,
      canonicalBounds.minimumLatitude,
      canonicalBounds.maximumLongitude,
      canonicalBounds.maximumLatitude,
    ] as const,
  };
};
