import { roadTrafficDetectorDataSchema } from '../../../entities/road-traffic/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchItsRoadTrafficDetectors } from '../../providers/its';

const ROAD_TRAFFIC_DETECTOR_SOURCE = '국가교통정보센터 ITS 차량검지';

type RoadTrafficDetectorRouteInput = Readonly<Record<string, never>>;
type RoadTrafficDetectorCacheIdentity = Readonly<{ scope: 'korea-road-traffic-detectors' }>;

export type CreateRoadTrafficDetectorsRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const ROAD_TRAFFIC_DETECTOR_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 5 * 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 15_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 30, windowMs: 60_000, scope: 'route.road-traffic-detectors' },
  upstreamBudget: {
    limit: 300,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-road-traffic-detectors',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.its-road-traffic-detectors',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 15_000,
  },
  cdnMaxAgeSeconds: 60,
});

export function createRoadTrafficDetectorsRoute(
  options: CreateRoadTrafficDetectorsRouteOptions,
): GatewayRoute<RoadTrafficDetectorRouteInput, RoadTrafficDetectorCacheIdentity, typeof roadTrafficDetectorDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'road-traffic-detectors',
    path: '/api/road-traffic/detectors',
    dataSchema: roadTrafficDetectorDataSchema,
    profile: ROAD_TRAFFIC_DETECTOR_ROUTE_PROFILE,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'korea-road-traffic-detectors' },
      };
    },
    async load(_input, signal) {
      const serviceKey = options.serviceKey?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }
      const fetchedAt = clock();
      if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0 || fetchedAt > 8_640_000_000_000_000) {
        throw new RangeError('Road traffic detector route clock must return a valid epoch millisecond value');
      }

      let data: Awaited<ReturnType<typeof fetchItsRoadTrafficDetectors>>;
      try {
        data = await fetchItsRoadTrafficDetectors({
          fetcher,
          now: fetchedAt,
          serviceKey,
          signal,
        });
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      return {
        kind: data.detectors.length === 0 ? 'empty' : 'value',
        data,
        fetchedAt,
        source: ROAD_TRAFFIC_DETECTOR_SOURCE,
      };
    },
  };
}
