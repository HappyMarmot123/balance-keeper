import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { roadEventDataSchema } from '../model/roadEvent';

export type RoadEventQueryDependencies = Readonly<{
  enabled?: boolean;
  fetcher?: JsonFetcher;
}>;

export const ROAD_EVENT_INCIDENTS_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 2 * 60_000,
    staleTime: 2 * 60_000,
  }),
);

export const ROAD_EVENT_DISASTERS_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
  }),
);

const incidentsDataSchema = roadEventDataSchema.refine(
  (snapshot) => snapshot.channel === 'incidents',
  'Road event incidents response must use the incidents channel',
);

const disastersDataSchema = roadEventDataSchema.refine(
  (snapshot) => snapshot.channel === 'disasters',
  'Road event disasters response must use the disasters channel',
);

export const roadEventIncidentsQueryOptions = (dependencies: RoadEventQueryDependencies = {}) => ({
  ...ROAD_EVENT_INCIDENTS_QUERY_PROFILE,
  enabled: dependencies.enabled ?? false,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/road-events/incidents', incidentsDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['road-events', 'incidents'] as const,
});

export const roadEventDisastersQueryOptions = (dependencies: RoadEventQueryDependencies = {}) => ({
  ...ROAD_EVENT_DISASTERS_QUERY_PROFILE,
  enabled: dependencies.enabled ?? false,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/road-events/disasters', disastersDataSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['road-events', 'disasters'] as const,
});
