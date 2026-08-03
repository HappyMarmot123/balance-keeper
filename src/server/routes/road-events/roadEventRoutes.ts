import { roadEventDataSchema } from '../../../entities/road-event/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchItsRoadDisasters, fetchItsRoadIncidents } from '../../providers/its';

const ROAD_EVENT_INCIDENTS_SOURCE = '국가교통정보센터 ITS 돌발상황';
const ROAD_EVENT_DISASTERS_SOURCE = '국가교통정보센터 ITS 재난상황';
const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

type RoadEventRouteInput = Readonly<Record<string, never>>;
type RoadEventCacheIdentity = Readonly<{
  scope: 'korea-road-events-disasters' | 'korea-road-events-incidents';
}>;

export type CreateRoadEventRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const ROAD_EVENT_INCIDENTS_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 2 * 60_000,
  staleIfErrorForMs: 15 * 60_000,
  negativeForMs: 30_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.road-events-incidents' },
  upstreamBudget: {
    limit: 720,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-road-events-incidents',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.its-road-events-incidents',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 30,
});

export const ROAD_EVENT_DISASTERS_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 5 * 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.road-events-disasters' },
  upstreamBudget: {
    limit: 288,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-road-events-disasters',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.its-road-events-disasters',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60,
});

type FetchRoadEvents = typeof fetchItsRoadIncidents;

type RoadEventRouteSpec = Readonly<{
  cacheScope: RoadEventCacheIdentity['scope'];
  fetchEvents: FetchRoadEvents;
  id: string;
  path: `/api/${string}`;
  profile: typeof ROAD_EVENT_INCIDENTS_ROUTE_PROFILE;
  source: string;
}>;

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0 || epochMs > MAX_DATE_EPOCH_MS) {
    throw new RangeError('Road event route clock must return a valid epoch millisecond value');
  }
};

const createRoadEventRoute = (
  options: CreateRoadEventRouteOptions,
  spec: RoadEventRouteSpec,
): GatewayRoute<RoadEventRouteInput, RoadEventCacheIdentity, typeof roadEventDataSchema> => {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: spec.id,
    path: spec.path,
    dataSchema: roadEventDataSchema,
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

      let data: Awaited<ReturnType<FetchRoadEvents>>;
      try {
        data = await spec.fetchEvents({ fetcher, now: fetchedAt, serviceKey, signal });
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      return {
        kind: data.events.length === 0 ? 'empty' : 'value',
        data,
        fetchedAt,
        source: spec.source,
      };
    },
  };
};

export const createRoadEventIncidentsRoute = (options: CreateRoadEventRouteOptions) =>
  createRoadEventRoute(options, {
    cacheScope: 'korea-road-events-incidents',
    fetchEvents: fetchItsRoadIncidents,
    id: 'road-events-incidents',
    path: '/api/road-events/incidents',
    profile: ROAD_EVENT_INCIDENTS_ROUTE_PROFILE,
    source: ROAD_EVENT_INCIDENTS_SOURCE,
  });

export const createRoadEventDisastersRoute = (options: CreateRoadEventRouteOptions) =>
  createRoadEventRoute(options, {
    cacheScope: 'korea-road-events-disasters',
    fetchEvents: fetchItsRoadDisasters,
    id: 'road-events-disasters',
    path: '/api/road-events/disasters',
    profile: ROAD_EVENT_DISASTERS_ROUTE_PROFILE,
    source: ROAD_EVENT_DISASTERS_SOURCE,
  });
