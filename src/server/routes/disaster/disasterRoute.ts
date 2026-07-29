import { disasterDataSchema } from '../../../entities/disaster/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchSafetydataDisasterMessages } from '../../providers/safetydata';

const DISASTER_SOURCE = '행정안전부 · 재난안전데이터공유플랫폼 · 공공누리 제4유형 기준';

export type CreateDisasterRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const DISASTER_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 3 * 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 3 * 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 120, windowMs: 60_000, scope: 'route.disaster' },
  upstreamBudget: {
    limit: 480,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.safetydata-disaster',
  },
  breaker: {
    scope: 'provider.safetydata-disaster',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60,
});

type DisasterRouteInput = Readonly<Record<string, never>>;

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < Date.UTC(2023, 0, 1)) {
    throw new RangeError('Disaster route clock must return a supported safe epoch millisecond value');
  }
};

export function createDisasterRoute(
  options: CreateDisasterRouteOptions,
): GatewayRoute<DisasterRouteInput, Readonly<{ scope: 'korea-disaster-alerts' }>, typeof disasterDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'disaster',
    path: '/api/disaster',
    dataSchema: disasterDataSchema,
    profile: DISASTER_ROUTE_PROFILE,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'korea-disaster-alerts' },
      };
    },
    async load(_input, signal) {
      const serviceKey = options.serviceKey?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      }

      const snapshotAt = clock();
      assertClock(snapshotAt);
      let snapshot: Awaited<ReturnType<typeof fetchSafetydataDisasterMessages>>;
      try {
        snapshot = await fetchSafetydataDisasterMessages({
          fetcher,
          now: snapshotAt,
          serviceKey,
          signal,
        });
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }
      const data = disasterDataSchema.parse(snapshot);
      const fetchedAt = clock();
      assertClock(fetchedAt);
      return {
        kind: data.alerts.length === 0 ? 'empty' : 'value',
        data,
        fetchedAt,
        source: DISASTER_SOURCE,
      };
    },
  };
}
