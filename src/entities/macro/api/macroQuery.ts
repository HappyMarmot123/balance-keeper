import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { macroDataSchema } from '../model/macro';

export type MacroQueryDependencies = Readonly<{
  fetcher?: JsonFetcher;
}>;

export const MACRO_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 6 * 60 * 60_000,
    staleTime: 3 * 60 * 60_000,
  }),
);

export const macroQueryOptions = (dependencies: MacroQueryDependencies = {}) => ({
  ...MACRO_QUERY_PROFILE,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/macro', macroDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['macro'] as const,
});
