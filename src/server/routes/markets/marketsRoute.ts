import { MARKET_INDEXES, marketDataSchema } from '../../../entities/market/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchFscMarketIndex } from '../../providers/fsc';

export type CreateMarketsRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const MARKETS_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 6 * 60 * 60_000,
  staleIfErrorForMs: 7 * 24 * 60 * 60_000,
  negativeForMs: 60 * 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.markets' },
  upstreamBudget: {
    limit: 48,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.fsc-market',
  },
  breaker: {
    scope: 'provider.fsc-market',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60 * 60,
});

type MarketsRouteInput = Readonly<Record<string, never>>;

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < Date.UTC(2020, 0, 1)) {
    throw new RangeError('Markets route clock must return a supported safe epoch millisecond value');
  }
};

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

export function createMarketsRoute(
  options: CreateMarketsRouteOptions,
): GatewayRoute<MarketsRouteInput, Readonly<{ scope: 'korea-delayed-markets' }>, typeof marketDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'markets',
    path: '/api/markets',
    dataSchema: marketDataSchema,
    profile: MARKETS_ROUTE_PROFILE,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }

      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'korea-delayed-markets' },
      };
    },
    async load(_input, signal) {
      const serviceKey = options.serviceKey;
      if (serviceKey === undefined) {
        throw new AppError('MISSING_CREDENTIALS');
      }
      if (signal.aborted) {
        throwAbortReason(signal);
      }

      const snapshotAt = clock();
      assertClock(snapshotAt);
      const attempts = MARKET_INDEXES.map((definition) =>
        fetchFscMarketIndex({
          definition,
          fetcher,
          now: snapshotAt,
          serviceKey,
          signal,
        }).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (error: unknown) => ({ error, status: 'rejected' as const }),
        ),
      );
      const results = await Promise.all(attempts);

      if (signal.aborted) {
        throwAbortReason(signal);
      }
      if (results.every((result) => result.status === 'rejected')) {
        rethrowAsUpstreamUnavailable(new Error('No domestic market index succeeded'), signal);
      }

      const indices = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        const definition = MARKET_INDEXES[index];
        if (definition === undefined) {
          throw new RangeError('Market index result position is invalid');
        }
        return {
          ...definition,
          observation: null,
          status: 'unavailable',
        };
      });
      const data = marketDataSchema.parse({ indices });
      const fetchedAt = clock();
      assertClock(fetchedAt);

      return {
        kind: data.indices.every((index) => index.status === 'empty') ? 'empty' : 'value',
        data,
        fetchedAt,
        source: '금융위원회 · 한국거래소 통계정보',
      };
    },
  };
}
