// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { weatherAlertDataSchema } from '../../../src/entities/weather-alert/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
const liveEnabled =
  process.env.RUN_KMA_WEATHER_ALERTS_LIVE_SMOKE === '1' && serviceKey !== undefined && serviceKey.length > 0;
const liveIt = liveEnabled ? it : it.skip;

describe('KMA weather alerts explicit live release gate', () => {
  liveIt(
    'serves one strict empty or active snapshot through the production gateway with at most three requests',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('Canonical data.go.kr credential is required for the weather-alert live smoke');
      }

      const requestedPaths: string[] = [];
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-weather-alerts-live-smoke',
        createRequestId: () => 'request-weather-alerts-live-smoke',
        environment: { DATA_GO_KR_SERVICE_KEY: serviceKey },
        fetcher: async (input, init) => {
          const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
          requestedPaths.push(url.pathname);
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const response = await runtime.handle(
        withTrustedAdmissionSubject(new Request('https://balance.test/api/weather/alerts'), '203.0.113.53'),
      );

      expect(response.status).toBe(200);
      const envelope = successEnvelopeSchema(weatherAlertDataSchema).parse(await response.json());
      expect(envelope.meta).toMatchObject({ cache: 'MISS', source: 'KMA' });
      expect(requestedPaths[0]).toBe('/1360000/WthrWrnInfoService/getPwnStatus');
      expect(requestedPaths).toHaveLength(envelope.data === null ? 1 : 3);
      expect(new Set(requestedPaths)).toEqual(
        envelope.data === null
          ? new Set(['/1360000/WthrWrnInfoService/getPwnStatus'])
          : new Set([
              '/1360000/WthrWrnInfoService/getPwnStatus',
              '/1360000/WthrWrnInfoService/getPwnCd',
              '/1360000/WthrWrnInfoService/getWthrWrnMsg',
            ]),
      );
    },
    15_000,
  );
});
