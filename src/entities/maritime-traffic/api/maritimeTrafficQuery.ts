import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { maritimeTrafficDataSchema } from '../model/maritimeTraffic';

export type MaritimeTrafficQueryDependencies = Readonly<{
  enabled?: boolean;
  fetcher?: JsonFetcher;
}>;

export const MARITIME_TRAFFIC_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
  }),
);

export const maritimeTrafficQueryOptions = (dependencies: MaritimeTrafficQueryDependencies = {}) => ({
  ...MARITIME_TRAFFIC_QUERY_PROFILE,
  enabled: dependencies.enabled ?? false,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/maritime-traffic', maritimeTrafficDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['maritime-traffic'] as const,
});
