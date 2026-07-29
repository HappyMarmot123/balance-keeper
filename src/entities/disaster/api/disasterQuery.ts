import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { disasterDataSchema } from '../model/disaster';

export type DisasterQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const DISASTER_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 60_000,
    staleTime: 60_000,
  }),
);

export const disasterQueryOptions = (dependencies: DisasterQueryDependencies = {}) => ({
  ...DISASTER_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/disaster', disasterDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['disaster-alerts'] as const,
});
