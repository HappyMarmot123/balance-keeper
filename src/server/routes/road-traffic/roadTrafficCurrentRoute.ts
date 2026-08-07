import { type RoadTrafficCurrentBounds, roadTrafficCurrentDataSchema } from '../../../entities/road-traffic/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchItsRoadTrafficCurrent } from '../../providers/its';
import { parseRoadTrafficCurrentBounds } from './roadTrafficCurrentRequest';

const ROAD_TRAFFIC_CURRENT_SOURCE = '국가교통정보센터 ITS 교통소통';

export type CreateRoadTrafficCurrentRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const ROAD_TRAFFIC_CURRENT_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 5 * 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 30, windowMs: 60_000, scope: 'route.road-traffic-current' },
  upstreamBudget: {
    limit: 500,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-road-traffic-current',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.its-road-traffic-current',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60,
});

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('Road traffic current route clock must return a non-negative safe epoch value');
  }
};

export function createRoadTrafficCurrentRoute(
  options: CreateRoadTrafficCurrentRouteOptions,
): GatewayRoute<RoadTrafficCurrentBounds, RoadTrafficCurrentBounds, typeof roadTrafficCurrentDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'road-traffic-current',
    path: '/api/road-traffic/current',
    dataSchema: roadTrafficCurrentDataSchema,
    profile: ROAD_TRAFFIC_CURRENT_ROUTE_PROFILE,
    parseRequest(request: Request) {
      const search = new URL(request.url).searchParams;
      for (const key of search.keys()) {
        if (key !== 'bbox') throw new AppError('BAD_REQUEST');
      }
      const values = search.getAll('bbox');
      if (values.length !== 1) throw new AppError('BAD_REQUEST');
      const bounds = parseRoadTrafficCurrentBounds(values[0] ?? '');
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: bounds,
        publicCacheIdentity: bounds,
      };
    },
    async load(input, signal) {
      const serviceKey = options.serviceKey?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }

      let data: Awaited<ReturnType<typeof fetchItsRoadTrafficCurrent>>;
      try {
        data = await fetchItsRoadTrafficCurrent({
          bounds: input,
          fetcher,
          serviceKey,
          signal,
        });
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      const fetchedAt = clock();
      assertClock(fetchedAt);
      return {
        kind: data.segments.length === 0 ? 'empty' : 'value',
        data,
        fetchedAt,
        source: ROAD_TRAFFIC_CURRENT_SOURCE,
      };
    },
  };
}
