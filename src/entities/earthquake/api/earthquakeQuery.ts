import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { earthquakeDataSchema } from '../model/earthquake';

export type EarthquakeQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const EARTHQUAKE_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 60_000,
    staleTime: 60_000,
  }),
);

export const earthquakeQueryOptions = (dependencies: EarthquakeQueryDependencies = {}) => ({
  ...EARTHQUAKE_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/earthquake', earthquakeDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['earthquakes'] as const,
});
