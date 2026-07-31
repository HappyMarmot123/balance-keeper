// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { maritimeTrafficDataSchema } from '../../../src/entities/maritime-traffic/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
const liveEnabled =
  process.env.RUN_KOMSA_MARITIME_TRAFFIC_LIVE_SMOKE === '1' && serviceKey !== undefined && serviceKey.length > 0;
const liveIt = liveEnabled ? it : it.skip;

describe('KOMSA maritime traffic explicit live release gate', () => {
  liveIt(
    'serves one strict and recent aggregate snapshot through the production gateway',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('Canonical data.go.kr credential is required for the maritime-traffic live smoke');
      }

      const now = Date.now();
      let providerRequestCount = 0;
      let providerRequest:
        | Readonly<{
            dataType: string | null;
            numOfRows: string | null;
            pageNo: string | null;
            pathname: string;
            protocol: string;
          }>
        | undefined;
      const runtime = createProductionGatewayRuntime({
        clock: () => now,
        createCoordinationToken: () => 'coordination-maritime-traffic-live-smoke',
        createRequestId: () => 'request-maritime-traffic-live-smoke',
        environment: { DATA_GO_KR_SERVICE_KEY: serviceKey },
        fetcher: async (input, init) => {
          const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
          providerRequestCount += 1;
          providerRequest = {
            dataType: url.searchParams.get('dataType'),
            numOfRows: url.searchParams.get('numOfRows'),
            pageNo: url.searchParams.get('pageNo'),
            pathname: url.pathname,
            protocol: url.protocol,
          };
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(() => now),
        logWriter: () => undefined,
      });

      const response = await runtime.handle(
        withTrustedAdmissionSubject(new Request('https://balance.test/api/maritime-traffic'), '203.0.113.112'),
      );
      expect(response.status).toBe(200);

      const envelope = successEnvelopeSchema(maritimeTrafficDataSchema).parse(await response.json());
      expect(envelope.meta).toMatchObject({
        cache: 'MISS',
        source: expect.stringContaining('한국해양교통안전공단'),
      });
      expect(providerRequestCount).toBe(1);
      expect(providerRequest).toEqual({
        dataType: 'JSON',
        numOfRows: '5000',
        pageNo: '1',
        pathname: '/B554035/realtime/get_realtime',
        protocol: 'https:',
      });
      expect(envelope.data.cells.length).toBeLessThanOrEqual(5_000);
      expect(envelope.data.generatedAt).toBeLessThanOrEqual(now + 10 * 60_000);
      expect(envelope.data.generatedAt).toBeGreaterThanOrEqual(now - 60 * 60_000);
    },
    15_000,
  );
});
