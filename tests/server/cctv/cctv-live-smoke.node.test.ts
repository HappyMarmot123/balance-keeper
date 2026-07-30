// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { cctvDataSchema } from '../../../src/entities/cctv/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const serviceKey = process.env.ITS_API_KEY?.trim();
const liveIt = serviceKey === undefined || serviceKey.length === 0 ? it.skip : it;

describe('ITS CCTV credential-gated live smoke', () => {
  liveIt(
    'serves and caches one strict atomic metadata snapshot through the production gateway',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('ITS_API_KEY is required for the live smoke');
      }

      let providerRequestCount = 0;
      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-cctv-live-smoke',
        createRequestId: () => 'request-cctv-live-smoke',
        environment: { ITS_API_KEY: serviceKey },
        fetcher: async (input, init) => {
          providerRequestCount += 1;
          return globalThis.fetch(input, init);
        },
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const createRequest = () =>
        withTrustedAdmissionSubject(
          new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38'),
          '203.0.113.94',
        );

      const missResponse = await runtime.handle(createRequest());
      expect(missResponse.status).toBe(200);
      const missEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await missResponse.json());
      expect(missEnvelope.meta).toMatchObject({
        cache: 'MISS',
        source: 'ITS 국가교통정보센터',
      });
      expect(missEnvelope.data.cameras.length).toBeGreaterThan(0);
      expect(providerRequestCount).toBe(4);

      const hitResponse = await runtime.handle(createRequest());
      const hitEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await hitResponse.json());
      expect(hitEnvelope.meta.cache).toBe('HIT');
      expect(hitEnvelope.data).toEqual(missEnvelope.data);
      expect(providerRequestCount).toBe(4);
    },
    20_000,
  );

  liveIt(
    'relays one on-demand bounded JPEG without exposing the provider URL',
    async () => {
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new TypeError('ITS_API_KEY is required for the live smoke');
      }

      const clock = Date.now;
      const runtime = createProductionGatewayRuntime({
        clock,
        createCoordinationToken: () => 'coordination-cctv-image-live-smoke',
        createRequestId: () => 'request-cctv-image-live-smoke',
        environment: { ITS_API_KEY: serviceKey },
        fetcher: globalThis.fetch,
        fleetStateStore: new MemoryFleetStateStore(clock),
        logWriter: () => undefined,
      });
      const trustedRequest = (path: string) =>
        withTrustedAdmissionSubject(new Request(`https://balance.test${path}`), '203.0.113.95');
      const listResponse = await runtime.handle(trustedRequest('/api/cctv/list?bbox=126.5,37,127.5,38'));
      expect(listResponse.status).toBe(200);
      const snapshot = successEnvelopeSchema(cctvDataSchema).parse(await listResponse.json()).data;
      const camera = snapshot.cameras[0];
      expect(camera).toBeDefined();
      if (camera === undefined) {
        throw new TypeError('CCTV live smoke requires at least one camera');
      }

      const response = await runtime.handle(
        trustedRequest(`/api/cctv/image?cameraId=${encodeURIComponent(camera.id)}&bbox=126.5,37,127.5,38`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('etag')).toBeNull();
      const declaredLength = Number(response.headers.get('content-length'));
      expect(declaredLength).toBeGreaterThan(0);
      expect(declaredLength).toBeLessThanOrEqual(512 * 1_024);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.byteLength).toBe(declaredLength);
      expect([...bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
      expect([...bytes.slice(-2)]).toEqual([0xff, 0xd9]);
    },
    30_000,
  );
});
