import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { newsDataSchema } from '../model/news';

export type NewsQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const NEWS_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  }),
);

export const newsQueryOptions = (dependencies: NewsQueryDependencies = {}) => ({
  ...NEWS_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/news', newsDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['news'] as const,
});
