import {
  EARTHQUAKE_BOUNDS,
  EARTHQUAKE_EVENT_LIMIT,
  EARTHQUAKE_PUBLIC_WINDOW_MS,
  earthquakeDataSchema,
  KMA_EARTHQUAKE_WINDOW_MS,
} from '../../../entities/earthquake/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchKmaEarthquakeRecords } from '../../providers/kma';
import { fetchUsgsEarthquakeRecords } from '../../providers/usgs';
import { reconcileEarthquakeRecords } from './reconcileEarthquakes';

export type CreateEarthquakeRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const EARTHQUAKE_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.earthquake' },
  upstreamBudget: {
    limit: 1_440,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.earthquake',
  },
  breaker: {
    scope: 'provider.earthquake',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 30,
});

type EarthquakeRouteInput = Readonly<Record<string, never>>;

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < EARTHQUAKE_PUBLIC_WINDOW_MS) {
    throw new RangeError('Earthquake route clock must return a supported non-negative safe epoch millisecond value');
  }
};

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

export function createEarthquakeRoute(
  options: CreateEarthquakeRouteOptions,
): GatewayRoute<EarthquakeRouteInput, Readonly<{ scope: 'east-asia-recent' }>, typeof earthquakeDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'earthquake',
    path: '/api/earthquake',
    dataSchema: earthquakeDataSchema,
    profile: EARTHQUAKE_ROUTE_PROFILE,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }

      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'east-asia-recent' },
      };
    },
    async load(_input, signal) {
      if (signal.aborted) {
        throwAbortReason(signal);
      }

      const snapshotTo = clock();
      assertClock(snapshotTo);
      const publicWindow = {
        from: snapshotTo - EARTHQUAKE_PUBLIC_WINDOW_MS,
        to: snapshotTo,
      };
      const kmaWindow = {
        from: snapshotTo - KMA_EARTHQUAKE_WINDOW_MS,
        to: snapshotTo,
      };

      const kmaAttempt =
        options.serviceKey === undefined
          ? undefined
          : fetchKmaEarthquakeRecords({
              fetcher,
              serviceKey: options.serviceKey,
              signal,
              window: kmaWindow,
            });
      const usgsAttempt = fetchUsgsEarthquakeRecords({
        fetcher,
        signal,
        window: publicWindow,
      });
      const [kmaResult, usgsResult] = await Promise.all([
        kmaAttempt === undefined
          ? Promise.resolve(undefined)
          : kmaAttempt.then(
              (value) => ({ status: 'fulfilled' as const, value }),
              () => ({ status: 'rejected' as const }),
            ),
        usgsAttempt.then(
          (value) => ({ status: 'fulfilled' as const, value }),
          () => ({ status: 'rejected' as const }),
        ),
      ]);

      if (signal.aborted) {
        throwAbortReason(signal);
      }

      const kmaStatus =
        kmaResult === undefined
          ? ('missing-credential' as const)
          : kmaResult.status === 'fulfilled'
            ? ('available' as const)
            : ('unavailable' as const);
      const usgsStatus = usgsResult.status === 'fulfilled' ? ('available' as const) : ('unavailable' as const);
      const hasSuccessfulSource = kmaStatus === 'available' || usgsStatus === 'available';
      if (!hasSuccessfulSource) {
        rethrowAsUpstreamUnavailable(new Error('No earthquake source succeeded'), signal);
      }

      const kmaRecords = kmaResult?.status === 'fulfilled' ? kmaResult.value : [];
      const usgsRecords = usgsResult.status === 'fulfilled' ? usgsResult.value : [];
      const events = reconcileEarthquakeRecords(kmaRecords, usgsRecords).slice(0, EARTHQUAKE_EVENT_LIMIT);
      const data = earthquakeDataSchema.parse({
        coverage: EARTHQUAKE_BOUNDS,
        events,
        sources: {
          kma: { ...kmaWindow, status: kmaStatus },
          usgs: { ...publicWindow, status: usgsStatus },
        },
        window: publicWindow,
      });
      const fetchedAt = clock();
      assertClock(fetchedAt);
      const sources = [...(kmaStatus === 'available' ? ['KMA'] : []), ...(usgsStatus === 'available' ? ['USGS'] : [])];

      return {
        kind: events.length === 0 && kmaStatus === 'available' && usgsStatus === 'available' ? 'empty' : 'value',
        data,
        fetchedAt,
        source: sources.join('+'),
      };
    },
  };
}
