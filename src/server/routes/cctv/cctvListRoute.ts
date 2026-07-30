import { type CctvBounds, cctvDataSchema } from '../../../entities/cctv/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchItsCctvList } from '../../providers/its';
import { parseCctvBounds } from './cctvRequest';

const CCTV_SOURCE = 'ITS 국가교통정보센터';

export type CreateCctvListRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const CCTV_LIST_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 10 * 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 5 * 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 30, windowMs: 60_000, scope: 'route.cctv-list' },
  upstreamBudget: {
    limit: 200,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-cctv',
  },
  breaker: {
    scope: 'provider.its-cctv',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 5 * 60,
});

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('CCTV route clock must return a non-negative safe epoch millisecond value');
  }
};

export function createCctvListRoute(
  options: CreateCctvListRouteOptions,
): GatewayRoute<CctvBounds, CctvBounds, typeof cctvDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'cctv-list',
    path: '/api/cctv/list',
    dataSchema: cctvDataSchema,
    profile: CCTV_LIST_ROUTE_PROFILE,
    parseRequest(request: Request) {
      const search = new URL(request.url).searchParams;
      for (const key of search.keys()) {
        if (key !== 'bbox') {
          throw new AppError('BAD_REQUEST');
        }
      }
      const values = search.getAll('bbox');
      if (values.length !== 1) {
        throw new AppError('BAD_REQUEST');
      }
      const bounds = parseCctvBounds(values[0] ?? '');
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

      let data: Awaited<ReturnType<typeof fetchItsCctvList>>;
      try {
        data = await fetchItsCctvList({
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
        kind: data.cameras.length === 0 ? 'empty' : 'value',
        data,
        fetchedAt,
        source: CCTV_SOURCE,
      };
    },
  };
}
