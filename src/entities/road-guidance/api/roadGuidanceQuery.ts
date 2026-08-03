import { createQueryProfile, fetchJson, type JsonFetcher } from '../../../shared/api';
import { safetyNoticeDataSchema, variableSpeedLimitDataSchema, vmsGuidanceDataSchema } from '../model/roadGuidance';

export type RoadGuidanceQueryDependencies = Readonly<{
  enabled?: boolean;
  fetcher?: JsonFetcher;
}>;

export const VMS_GUIDANCE_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 2 * 60_000,
    staleTime: 2 * 60_000,
  }),
);

export const SAFETY_NOTICE_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
  }),
);

export const VARIABLE_SPEED_LIMIT_QUERY_PROFILE = Object.freeze(
  createQueryProfile({
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
  }),
);

const vmsResponseSchema = vmsGuidanceDataSchema.refine(
  (snapshot) => snapshot.channel === 'vms',
  'VMS guidance response must use the vms channel',
);
const safetyNoticeResponseSchema = safetyNoticeDataSchema.refine(
  (snapshot) => snapshot.channel === 'safety-notices',
  'Safety notice response must use the safety-notices channel',
);
const variableSpeedLimitResponseSchema = variableSpeedLimitDataSchema.refine(
  (snapshot) => snapshot.channel === 'variable-speed-limits',
  'Variable speed limit response must use the variable-speed-limits channel',
);

export const vmsGuidanceQueryOptions = (dependencies: RoadGuidanceQueryDependencies = {}) => ({
  ...VMS_GUIDANCE_QUERY_PROFILE,
  enabled: dependencies.enabled ?? false,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/road-guidance/vms', vmsResponseSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['road-guidance', 'vms'] as const,
});

export const safetyNoticeQueryOptions = (dependencies: RoadGuidanceQueryDependencies = {}) => ({
  ...SAFETY_NOTICE_QUERY_PROFILE,
  enabled: dependencies.enabled ?? false,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/road-guidance/safety-notices', safetyNoticeResponseSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['road-guidance', 'safety-notices'] as const,
});

export const variableSpeedLimitQueryOptions = (dependencies: RoadGuidanceQueryDependencies = {}) => ({
  ...VARIABLE_SPEED_LIMIT_QUERY_PROFILE,
  enabled: dependencies.enabled ?? false,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchJson('/api/road-guidance/variable-speed-limits', variableSpeedLimitResponseSchema, {
      fetcher: dependencies.fetcher,
      signal,
    }),
  queryKey: ['road-guidance', 'variable-speed-limits'] as const,
});
