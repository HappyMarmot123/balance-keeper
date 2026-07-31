import { weatherAlertDataSchema } from '../../../entities/weather-alert/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchKmaWeatherAlerts } from '../../providers/kma';

type WeatherAlertsRouteInput = Readonly<Record<string, never>>;
type WeatherAlertsCacheIdentity = Readonly<{ scope: 'korea-weather-alerts' }>;

export const WEATHER_ALERTS_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 60_000,
  staleIfErrorForMs: 10 * 60_000,
  negativeForMs: 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 60, windowMs: 60_000, scope: 'route.weather' },
  upstreamBudget: { limit: 7_000, windowMs: 24 * 60 * 60_000, scope: 'provider.kma' },
  upstreamBudgetCost: 3,
  breaker: {
    scope: 'provider.kma.alerts',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 30,
});

export type CreateWeatherAlertsRouteOptions = Readonly<{
  clock: () => number;
  fetcher: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('Weather alerts route clock must return a non-negative safe epoch millisecond value');
  }
};

export function createWeatherAlertsRoute(
  options: CreateWeatherAlertsRouteOptions,
): GatewayRoute<WeatherAlertsRouteInput, WeatherAlertsCacheIdentity, typeof weatherAlertDataSchema> {
  return {
    id: 'weather-alerts',
    path: '/api/weather/alerts',
    dataSchema: weatherAlertDataSchema,
    profile: WEATHER_ALERTS_ROUTE_PROFILE,
    parseRequest(request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'korea-weather-alerts' },
      };
    },
    async load(_input, signal) {
      const serviceKey = options.serviceKey?.trim() ?? '';
      if (serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }

      let data: Awaited<ReturnType<typeof fetchKmaWeatherAlerts>>;
      try {
        data = await fetchKmaWeatherAlerts({
          clock: options.clock,
          fetcher: options.fetcher,
          serviceKey,
          signal,
        });
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      const fetchedAt = options.clock();
      assertClock(fetchedAt);
      return {
        kind: data === null ? 'empty' : 'value',
        data,
        fetchedAt,
        source: 'KMA',
      };
    },
  };
}
