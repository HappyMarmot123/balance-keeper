import { MACRO_SERIES, macroDataSchema } from '../../../entities/macro/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchEcosMacroSeries } from '../../providers/ecos';

export type CreateMacroRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const MACRO_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 6 * 60 * 60_000,
  staleIfErrorForMs: 7 * 24 * 60 * 60_000,
  negativeForMs: 60 * 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.macro' },
  upstreamBudget: {
    limit: 24,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.ecos',
  },
  breaker: {
    scope: 'provider.ecos',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 60 * 60,
});

type MacroRouteInput = Readonly<Record<string, never>>;

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < Date.UTC(2000, 0, 1)) {
    throw new RangeError('Macro route clock must return a supported safe epoch millisecond value');
  }
};

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

export function createMacroRoute(
  options: CreateMacroRouteOptions,
): GatewayRoute<MacroRouteInput, Readonly<{ scope: 'korea-core-macro' }>, typeof macroDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'macro',
    path: '/api/macro',
    dataSchema: macroDataSchema,
    profile: MACRO_ROUTE_PROFILE,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }

      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'korea-core-macro' },
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
      const attempts = MACRO_SERIES.map((series) =>
        fetchEcosMacroSeries({
          fetcher,
          now: snapshotAt,
          series,
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
        rethrowAsUpstreamUnavailable(new Error('No ECOS macro series succeeded'), signal);
      }

      const series = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        const definition = MACRO_SERIES[index];
        if (definition === undefined) {
          throw new RangeError('Macro series result index is invalid');
        }
        return {
          ...definition,
          observation: null,
          status: 'unavailable',
        };
      });
      const data = macroDataSchema.parse({ series });
      const fetchedAt = clock();
      assertClock(fetchedAt);

      return {
        kind: data.series.every((item) => item.status === 'empty') ? 'empty' : 'value',
        data,
        fetchedAt,
        source: 'ECOS',
      };
    },
  };
}
