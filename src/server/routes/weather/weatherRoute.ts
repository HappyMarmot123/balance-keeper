import { WEATHER_REGIONS, weatherNowcastDataSchema } from '../../../entities/weather/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchKmaUltraShortNowcast, normalizeKmaUltraShortNowcast, resolveKmaNowcastSlot } from '../../providers/kma';

type WeatherRegionId = keyof typeof WEATHER_REGIONS;

export const WEATHER_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 10 * 60_000,
  staleIfErrorForMs: 60 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.weather' },
  upstreamBudget: { limit: 7_000, windowMs: 24 * 60 * 60_000, scope: 'provider.kma' },
  breaker: {
    scope: 'provider.kma',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 5 * 60,
});

export type CreateWeatherRouteOptions = Readonly<{
  clock: () => number;
  fetcher: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

type WeatherRouteInput = Readonly<{ region: WeatherRegionId }>;

const normalizeRegion = (request: Request): WeatherRegionId => {
  const search = new URL(request.url).searchParams;
  for (const key of search.keys()) {
    if (key !== 'region') {
      throw new AppError('BAD_REQUEST');
    }
  }

  const regions = search.getAll('region');
  if (regions.length === 0) {
    return 'seoul';
  }
  if (regions.length !== 1) {
    throw new AppError('BAD_REQUEST');
  }

  const region = regions[0]?.trim().toLowerCase() ?? '';
  if (!Object.hasOwn(WEATHER_REGIONS, region)) {
    throw new AppError('BAD_REQUEST');
  }

  return region as WeatherRegionId;
};

const readCollectionTime = (clock: () => number): number => {
  const epochMs = clock();
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('Weather route clock must return a non-negative safe epoch millisecond value');
  }
  return epochMs;
};

export function createWeatherRoute(
  options: CreateWeatherRouteOptions,
): GatewayRoute<WeatherRouteInput, WeatherRouteInput, typeof weatherNowcastDataSchema> {
  return {
    id: 'weather',
    path: '/api/weather',
    dataSchema: weatherNowcastDataSchema,
    profile: WEATHER_ROUTE_PROFILE,
    parseRequest(request) {
      const region = normalizeRegion(request);
      const input = Object.freeze({ region });
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input,
        publicCacheIdentity: input,
      };
    },
    async load(input, signal) {
      const serviceKey = options.serviceKey?.trim() ?? '';
      if (serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }

      const slot = resolveKmaNowcastSlot(readCollectionTime(options.clock));
      let data: ReturnType<typeof normalizeKmaUltraShortNowcast>;
      try {
        const raw = await fetchKmaUltraShortNowcast({
          fetcher: options.fetcher,
          region: WEATHER_REGIONS[input.region],
          serviceKey,
          signal,
          slot,
        });
        data = normalizeKmaUltraShortNowcast(raw, input.region, slot);
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      return {
        kind: data === null ? 'empty' : 'value',
        data,
        fetchedAt: readCollectionTime(options.clock),
        source: 'KMA',
      };
    },
  };
}
