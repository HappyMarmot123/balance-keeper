import { maritimeTrafficDataSchema } from '../../../entities/maritime-traffic/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchMaritimeTrafficSnapshot } from '../../providers/komsa';

const MARITIME_TRAFFIC_SOURCE = '한국해양교통안전공단 MTIS · 공공데이터포털';

type MaritimeTrafficRouteInput = Readonly<Record<string, never>>;
type MaritimeTrafficCacheIdentity = Readonly<{ scope: 'korea-maritime-traffic-latest' }>;

export type CreateMaritimeTrafficRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const MARITIME_TRAFFIC_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 5 * 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.maritime-traffic' },
  upstreamBudget: {
    limit: 400,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.komsa-mtis',
  },
  upstreamBudgetCost: 1,
  breaker: {
    scope: 'provider.komsa-mtis',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60,
});

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('Maritime traffic route clock must return a non-negative safe epoch millisecond value');
  }
};

export function createMaritimeTrafficRoute(
  options: CreateMaritimeTrafficRouteOptions,
): GatewayRoute<MaritimeTrafficRouteInput, MaritimeTrafficCacheIdentity, typeof maritimeTrafficDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'maritime-traffic',
    path: '/api/maritime-traffic',
    dataSchema: maritimeTrafficDataSchema,
    profile: MARITIME_TRAFFIC_ROUTE_PROFILE,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }

      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'korea-maritime-traffic-latest' },
      };
    },
    async load(_input, signal) {
      const serviceKey = options.serviceKey?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }

      let data: Awaited<ReturnType<typeof fetchMaritimeTrafficSnapshot>>;
      try {
        data = await fetchMaritimeTrafficSnapshot({
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
        kind: data.cells.length === 0 ? 'empty' : 'value',
        data,
        fetchedAt,
        source: MARITIME_TRAFFIC_SOURCE,
      };
    },
  };
}
