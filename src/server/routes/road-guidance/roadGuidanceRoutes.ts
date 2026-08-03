import {
  safetyNoticeSnapshotSchema,
  variableSpeedLimitSnapshotSchema,
  vmsGuidanceSnapshotSchema,
} from '../../../entities/road-guidance/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type GatewayRouteProfile,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import {
  fetchItsSafetyNotices,
  fetchItsVariableSpeedLimits,
  fetchItsVmsGuidance,
} from '../../providers/its/roadGuidance';

const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;
const VMS_SOURCE = '국가교통정보센터 ITS 도로전광표지';
const SAFETY_NOTICE_SOURCE = '국가교통정보센터 ITS 주의운전구간';
const VARIABLE_SPEED_LIMIT_SOURCE = '국가교통정보센터 ITS 가변형 속도제한표지';

type RoadGuidanceRouteInput = Readonly<Record<string, never>>;
type RoadGuidanceCacheIdentity = Readonly<{
  scope: 'korea-road-guidance-safety-notices' | 'korea-road-guidance-variable-speed-limits' | 'korea-road-guidance-vms';
}>;

type RoadGuidanceSnapshot =
  | Awaited<ReturnType<typeof fetchItsSafetyNotices>>
  | Awaited<ReturnType<typeof fetchItsVariableSpeedLimits>>
  | Awaited<ReturnType<typeof fetchItsVmsGuidance>>;

type RoadGuidanceRouteSpecBase = Readonly<{
  cacheScope: RoadGuidanceCacheIdentity['scope'];
  id: string;
  path: `/api/${string}`;
  profile: GatewayRouteProfile;
  source: string;
}>;

type RoadGuidanceRouteSpec =
  | (RoadGuidanceRouteSpecBase &
      Readonly<{
        dataSchema: typeof safetyNoticeSnapshotSchema;
        fetchGuidance: typeof fetchItsSafetyNotices;
      }>)
  | (RoadGuidanceRouteSpecBase &
      Readonly<{
        dataSchema: typeof variableSpeedLimitSnapshotSchema;
        fetchGuidance: typeof fetchItsVariableSpeedLimits;
      }>)
  | (RoadGuidanceRouteSpecBase &
      Readonly<{
        dataSchema: typeof vmsGuidanceSnapshotSchema;
        fetchGuidance: typeof fetchItsVmsGuidance;
      }>);

export type CreateRoadGuidanceRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const VMS_GUIDANCE_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 2 * 60_000,
  staleIfErrorForMs: 15 * 60_000,
  negativeForMs: 30_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.road-guidance-vms' },
  upstreamBudget: {
    limit: 720,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-road-guidance-vms',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.its-road-guidance-vms',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 30,
});

export const SAFETY_NOTICE_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 5 * 60_000,
  staleIfErrorForMs: 30 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.road-guidance-safety-notices' },
  upstreamBudget: {
    limit: 288,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-road-guidance-safety-notices',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.its-road-guidance-safety-notices',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60,
});

export const VARIABLE_SPEED_LIMIT_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 5 * 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.road-guidance-variable-speed-limits' },
  upstreamBudget: {
    limit: 288,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-road-guidance-variable-speed-limits',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.its-road-guidance-variable-speed-limits',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60,
});

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0 || epochMs > MAX_DATE_EPOCH_MS) {
    throw new RangeError('Road guidance route clock must return a valid epoch millisecond value');
  }
};

const createRoadGuidanceRoute = (
  options: CreateRoadGuidanceRouteOptions,
  spec: RoadGuidanceRouteSpec,
): GatewayRoute<RoadGuidanceRouteInput, RoadGuidanceCacheIdentity> => {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: spec.id,
    path: spec.path,
    dataSchema: spec.dataSchema,
    profile: spec.profile,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: spec.cacheScope },
      };
    },
    async load(_input, signal) {
      const serviceKey = options.serviceKey?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }
      const fetchedAt = clock();
      assertClock(fetchedAt);

      let data: RoadGuidanceSnapshot;
      try {
        data = await spec.fetchGuidance({ fetcher, now: fetchedAt, serviceKey, signal });
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      return {
        kind: data.items.length === 0 ? 'empty' : 'value',
        data,
        fetchedAt,
        source: spec.source,
      };
    },
  };
};

export const createVmsGuidanceRoute = (options: CreateRoadGuidanceRouteOptions) =>
  createRoadGuidanceRoute(options, {
    cacheScope: 'korea-road-guidance-vms',
    dataSchema: vmsGuidanceSnapshotSchema,
    fetchGuidance: fetchItsVmsGuidance,
    id: 'road-guidance-vms',
    path: '/api/road-guidance/vms',
    profile: VMS_GUIDANCE_ROUTE_PROFILE,
    source: VMS_SOURCE,
  });

export const createSafetyNoticeRoute = (options: CreateRoadGuidanceRouteOptions) =>
  createRoadGuidanceRoute(options, {
    cacheScope: 'korea-road-guidance-safety-notices',
    dataSchema: safetyNoticeSnapshotSchema,
    fetchGuidance: fetchItsSafetyNotices,
    id: 'road-guidance-safety-notices',
    path: '/api/road-guidance/safety-notices',
    profile: SAFETY_NOTICE_ROUTE_PROFILE,
    source: SAFETY_NOTICE_SOURCE,
  });

export const createVariableSpeedLimitRoute = (options: CreateRoadGuidanceRouteOptions) =>
  createRoadGuidanceRoute(options, {
    cacheScope: 'korea-road-guidance-variable-speed-limits',
    dataSchema: variableSpeedLimitSnapshotSchema,
    fetchGuidance: fetchItsVariableSpeedLimits,
    id: 'road-guidance-variable-speed-limits',
    path: '/api/road-guidance/variable-speed-limits',
    profile: VARIABLE_SPEED_LIMIT_ROUTE_PROFILE,
    source: VARIABLE_SPEED_LIMIT_SOURCE,
  });
