import { roadTrafficForecastDataSchema } from '../../../entities/road-traffic/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchItsRoadTrafficForecast } from '../../providers/its';

const ROAD_TRAFFIC_FORECAST_SOURCE = '국가교통정보센터 ITS 교통예측';

type RoadTrafficForecastRouteInput = Readonly<Record<string, never>>;
type RoadTrafficForecastCacheIdentity = Readonly<{
  scope: 'korea-road-traffic-forecast-section-1';
}>;

export type CreateRoadTrafficForecastRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const ROAD_TRAFFIC_FORECAST_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 30 * 60_000,
  staleIfErrorForMs: 6 * 60 * 60_000,
  negativeForMs: 5 * 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.road-traffic-forecast' },
  upstreamBudget: {
    limit: 48,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-road-traffic-forecast',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.its-road-traffic-forecast',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60,
});

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('Road traffic forecast route clock must return a non-negative safe epoch value');
  }
};

export function createRoadTrafficForecastRoute(
  options: CreateRoadTrafficForecastRouteOptions,
): GatewayRoute<RoadTrafficForecastRouteInput, RoadTrafficForecastCacheIdentity, typeof roadTrafficForecastDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'road-traffic-forecast',
    path: '/api/road-traffic/forecast',
    dataSchema: roadTrafficForecastDataSchema,
    profile: ROAD_TRAFFIC_FORECAST_ROUTE_PROFILE,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'korea-road-traffic-forecast-section-1' },
      };
    },
    async load(_input, signal) {
      const serviceKey = options.serviceKey?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }
      const fetchedAt = clock();
      assertClock(fetchedAt);

      let data: Awaited<ReturnType<typeof fetchItsRoadTrafficForecast>>;
      try {
        data = await fetchItsRoadTrafficForecast({
          fetcher,
          now: fetchedAt,
          serviceKey,
          signal,
        });
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      return {
        kind: data.segments.length === 0 ? 'empty' : 'value',
        data,
        fetchedAt,
        source: ROAD_TRAFFIC_FORECAST_SOURCE,
      };
    },
  };
}
