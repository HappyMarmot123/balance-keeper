import type { FleetStateStore } from '../cache';
import { readAirKoreaConfig } from '../providers/airkorea';
import { readEcosCredential } from '../providers/ecos';
import { readFscMarketCredential } from '../providers/fsc';
import { readItsCredential } from '../providers/its';
import { readKmaEarthquakeCredential, readKmaWeatherCredential } from '../providers/kma';
import { readSafetydataCredential } from '../providers/safetydata';
import { createAirRoute } from '../routes/air';
import { createCctvListRoute, createCctvLiveStreamRoute, createCctvStillImageRoute } from '../routes/cctv';
import { createDisasterRoute } from '../routes/disaster';
import { createEarthquakeRoute } from '../routes/earthquake';
import { createMacroRoute } from '../routes/macro';
import { createMaritimeTrafficRoute } from '../routes/maritime-traffic';
import { createMarketsRoute } from '../routes/markets';
import { createNewsRoute } from '../routes/news';
import { createRoadEventDisastersRoute, createRoadEventIncidentsRoute } from '../routes/road-events';
import {
  createSafetyNoticeRoute,
  createVariableSpeedLimitRoute,
  createVmsGuidanceRoute,
} from '../routes/road-guidance';
import {
  createRoadTrafficCurrentRoute,
  createRoadTrafficDetectorsRoute,
  createRoadTrafficForecastRoute,
} from '../routes/road-traffic';
import { createWeatherAlertsRoute, createWeatherForecastRoute, createWeatherRoute } from '../routes/weather';
import { createGatewayRuntime, type GatewayRuntime } from './createGatewayRuntime';
import { createJsonGatewayLogger, type GatewayLogWriter } from './jsonGatewayLogger';
import type { RuntimeEnvironment } from './runtimeConfig';
import { readTrustedAdmissionSubject } from './trustedAdmissionSubject';

let productionRuntime: GatewayRuntime | undefined;

export class ProductionRuntimeConfigurationError extends Error {
  constructor(cause: unknown) {
    super('Production gateway runtime configuration is invalid', { cause });
    this.name = 'ProductionRuntimeConfigurationError';
  }
}

export type CreateProductionGatewayRuntimeOptions = Readonly<{
  clock?: () => number;
  createCoordinationToken?: () => string;
  createRequestId?: () => string;
  environment?: RuntimeEnvironment;
  fetcher?: typeof fetch;
  fleetStateStore?: FleetStateStore;
  logWriter?: GatewayLogWriter;
}>;

export function createProductionGatewayRuntime(options: CreateProductionGatewayRuntimeOptions = {}): GatewayRuntime {
  const environment = options.environment ?? process.env;
  const clock = options.clock ?? Date.now;
  const dataGoKrServiceKey = readKmaWeatherCredential(environment);
  const weatherRoute = createWeatherRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: dataGoKrServiceKey,
  });
  const weatherForecastRoute = createWeatherForecastRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: dataGoKrServiceKey,
  });
  const weatherAlertsRoute = createWeatherAlertsRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: dataGoKrServiceKey,
  });
  const airRoute = createAirRoute({
    clock,
    config: readAirKoreaConfig(environment),
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
  });
  const earthquakeRoute = createEarthquakeRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: readKmaEarthquakeCredential(environment),
  });
  const macroRoute = createMacroRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: readEcosCredential(environment),
  });
  const marketsRoute = createMarketsRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: readFscMarketCredential(environment),
  });
  const newsRoute = createNewsRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
  });
  const disasterRoute = createDisasterRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: readSafetydataCredential(environment),
  });
  const maritimeTrafficRoute = createMaritimeTrafficRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: dataGoKrServiceKey,
  });
  const itsServiceKey = readItsCredential(environment);
  const roadEventIncidentsRoute = createRoadEventIncidentsRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const roadEventDisastersRoute = createRoadEventDisastersRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const roadTrafficForecastRoute = createRoadTrafficForecastRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const roadTrafficCurrentRoute = createRoadTrafficCurrentRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const roadTrafficDetectorsRoute = createRoadTrafficDetectorsRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const vmsGuidanceRoute = createVmsGuidanceRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const safetyNoticeRoute = createSafetyNoticeRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const variableSpeedLimitRoute = createVariableSpeedLimitRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const cctvListRoute = createCctvListRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const cctvStillImageRoute = createCctvStillImageRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });
  const cctvLiveStreamRoute = createCctvLiveStreamRoute({
    clock,
    fetcher: options.fetcher ?? globalThis.fetch,
    readAdmissionSubject: readTrustedAdmissionSubject,
    serviceKey: itsServiceKey,
  });

  return createGatewayRuntime({
    clock,
    ...(options.createCoordinationToken === undefined
      ? {}
      : { createCoordinationToken: options.createCoordinationToken }),
    ...(options.createRequestId === undefined ? {} : { createRequestId: options.createRequestId }),
    environment,
    ...(options.fleetStateStore === undefined ? {} : { fleetStateStore: options.fleetStateStore }),
    logger: createJsonGatewayLogger(options.logWriter),
    routes: [
      weatherRoute,
      weatherForecastRoute,
      weatherAlertsRoute,
      airRoute,
      earthquakeRoute,
      macroRoute,
      marketsRoute,
      newsRoute,
      disasterRoute,
      maritimeTrafficRoute,
      roadEventIncidentsRoute,
      roadEventDisastersRoute,
      roadTrafficCurrentRoute,
      roadTrafficForecastRoute,
      roadTrafficDetectorsRoute,
      vmsGuidanceRoute,
      safetyNoticeRoute,
      variableSpeedLimitRoute,
      cctvListRoute,
      cctvStillImageRoute,
      cctvLiveStreamRoute,
    ],
  });
}

export function getProductionGatewayRuntime(): GatewayRuntime {
  if (productionRuntime === undefined) {
    try {
      productionRuntime = createProductionGatewayRuntime();
    } catch (error) {
      throw new ProductionRuntimeConfigurationError(error);
    }
  }

  return productionRuntime;
}
