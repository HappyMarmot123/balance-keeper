// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { roadTrafficForecastDataSchema } from '../../../src/entities/road-traffic/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.ITS_API_KEY?.trim();
const liveIt = process.env.RUN_ITS_ROAD_TRAFFIC_FORECAST_LIVE_SMOKE === '1' ? it : it.skip;

describe('ITS road traffic forecast explicit live release gate', () => {
  liveIt(
    'serves one strict MISS then HIT through the production gateway without retaining the credential',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('ITS credential is required for the road-traffic forecast live smoke');
      }

      const now = Date.now();
      let providerRequestCount = 0;
      let providerRequest:
        | Readonly<{
            dateShapeIsValid: boolean;
            hourShapeIsValid: boolean;
            pathname: string;
            protocol: string;
            queryNames: readonly string[];
            sectionIsCanonical: boolean;
          }>
        | undefined;
      let requestId = 0;
      const runtime = createProductionGatewayRuntime({
        clock: () => now,
        createCoordinationToken: () => 'coordination-road-traffic-forecast-live-smoke',
        createRequestId: () => `request-road-traffic-forecast-live-smoke-${++requestId}`,
        environment: { ITS_API_KEY: serviceKey },
        fetcher: async (input, init) => {
          const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
          providerRequestCount += 1;
          providerRequest = {
            dateShapeIsValid: /^\d{8}$/u.test(url.searchParams.get('fCastDate') ?? ''),
            hourShapeIsValid: /^(?:[01]\d|2[0-3])$/u.test(url.searchParams.get('fCastHour') ?? ''),
            pathname: url.pathname,
            protocol: url.protocol,
            queryNames: [...url.searchParams.keys()].sort(),
            sectionIsCanonical: url.searchParams.get('sectionId') === '1',
          };
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(() => now),
        logWriter: () => undefined,
      });
      const createRequest = () =>
        withTrustedAdmissionSubject(new Request('https://balance.test/api/road-traffic/forecast'), '203.0.113.138');

      const missResponse = await runtime.handle(createRequest());
      expect(missResponse.status).toBe(200);
      const missEnvelope = successEnvelopeSchema(roadTrafficForecastDataSchema).parse(await missResponse.json());
      expect(missEnvelope.meta).toMatchObject({ cache: 'MISS', source: expect.stringContaining('국가교통정보센터') });

      const hitResponse = await runtime.handle(createRequest());
      expect(hitResponse.status).toBe(200);
      const hitEnvelope = successEnvelopeSchema(roadTrafficForecastDataSchema).parse(await hitResponse.json());
      expect(hitEnvelope.meta.cache).toBe('HIT');
      expect(hitEnvelope.data).toEqual(missEnvelope.data);

      expect(providerRequestCount).toBe(1);
      expect(providerRequest).toEqual({
        dateShapeIsValid: true,
        hourShapeIsValid: true,
        pathname: '/bypassFCastInfo',
        protocol: 'https:',
        queryNames: ['apiKey', 'fCastDate', 'fCastHour', 'getType', 'sectionId'],
        sectionIsCanonical: true,
      });
      expect(JSON.stringify([missEnvelope, hitEnvelope])).not.toContain(serviceKey);
    },
    15_000,
  );
});
