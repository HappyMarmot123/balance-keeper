import {
  AIR_QUALITY_REGIONS,
  type AirQualityRegionId,
  airQualityDataSchema,
  normalizeAirQualityRegion,
} from '../../../entities/air-quality/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { type AirKoreaConfig, fetchAirKoreaInputs, normalizeAirKoreaSnapshot } from '../../providers/airkorea';

export type CreateAirRouteOptions = Readonly<{
  clock?: () => number;
  config?: AirKoreaConfig;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
}>;

export const AIR_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 30 * 60_000,
  staleIfErrorForMs: 2 * 60 * 60_000,
  negativeForMs: 5 * 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.air' },
  upstreamBudget: {
    limit: 350,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.airkorea',
  },
  breaker: {
    scope: 'provider.airkorea',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 15 * 60,
});

type AirRouteInput = Readonly<{ region: AirQualityRegionId }>;

export function createAirRoute(
  options: CreateAirRouteOptions,
): GatewayRoute<AirRouteInput, AirRouteInput, typeof airQualityDataSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'air',
    path: '/api/air',
    dataSchema: airQualityDataSchema,
    profile: AIR_ROUTE_PROFILE,
    parseRequest(request: Request) {
      const search = new URL(request.url).searchParams;
      for (const key of search.keys()) {
        if (key !== 'region') {
          throw new AppError('BAD_REQUEST');
        }
      }
      const regions = search.getAll('region');
      let region: AirQualityRegionId | undefined = 'seoul';
      if (regions.length > 0) {
        if (regions.length !== 1) {
          throw new AppError('BAD_REQUEST');
        }
        region = normalizeAirQualityRegion(regions[0] ?? '');
        if (region === undefined) {
          throw new AppError('BAD_REQUEST');
        }
      }

      const input = Object.freeze({ region });
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input,
        publicCacheIdentity: input,
      };
    },
    async load(input, signal) {
      if (options.config === undefined) {
        throw new AppError('MISSING_CREDENTIALS');
      }

      let data: ReturnType<typeof normalizeAirKoreaSnapshot>;
      try {
        const raw = await fetchAirKoreaInputs({
          config: options.config,
          fetcher,
          providerRegionName: AIR_QUALITY_REGIONS[input.region].providerName,
          signal,
        });
        data = normalizeAirKoreaSnapshot(raw.measurement, raw.stationDirectory, input.region);
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      const fetchedAt = clock();
      if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) {
        throw new RangeError('Air-quality route clock must return a non-negative safe epoch millisecond value');
      }

      return {
        kind: data === null ? 'empty' : 'value',
        data,
        fetchedAt,
        source: 'AirKorea',
      };
    },
  };
}
