import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { marketDataSchema } from '../model/market';

export type MarketQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const MARKET_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 6 * 60 * 60_000,
    staleTime: 3 * 60 * 60_000,
  }),
);

export const marketQueryOptions = (dependencies: MarketQueryDependencies = {}) => ({
  ...MARKET_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/markets', marketDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['markets'] as const,
});
