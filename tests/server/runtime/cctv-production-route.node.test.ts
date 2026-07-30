// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { cctvDataSchema } from '../../../src/entities/cctv/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-success.json', import.meta.url), 'utf8'),
) as {
  expressway: { live: unknown; still: unknown };
  nationalRoad: { live: unknown; still: unknown };
};
const emptyFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-empty.json', import.meta.url), 'utf8'),
) as unknown;

const expresswayCameraId = `its-cctv:${createHash('sha256')
  .update(JSON.stringify(['ex', '0010', '서울고속도로 CCTV', 127.01, 37.51]), 'utf8')
  .digest('base64url')
  .slice(0, 16)}`;

const stillUrl =
  'https://cctvsec.ktict.co.kr:8091/4003/QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==';

const jpegBytes = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x20, 0x01, 0x60, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03,
  0x11, 0x00, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00, 0x01, 0xff, 0xd9,
]);

describe('CCTV production gateway registration', () => {
  it('serves MISS, HIT and ETag revalidation through the one coarse gateway', async () => {
    let requestSequence = 0;
    const clock = () => 1_785_360_000_000;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const roadFixture =
        url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
      const body = url.searchParams.get('cctvType') === '3' ? roadFixture.still : roadFixture.live;
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    const runtime = createProductionGatewayRuntime({
      clock,
      createCoordinationToken: () => 'coordination-cctv-runtime',
      createRequestId: () => `request-cctv-runtime-${++requestSequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(clock),
      logWriter: () => undefined,
    });
    const createRequest = (headers?: HeadersInit) =>
      withTrustedAdmissionSubject(
        new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38', { headers }),
        '203.0.113.91',
      );

    const missResponse = await runtime.handle(createRequest());
    expect(missResponse.status).toBe(200);
    const etag = missResponse.headers.get('etag');
    expect(etag).not.toBeNull();
    const missEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await missResponse.json());
    expect(missEnvelope.meta).toMatchObject({
      cache: 'MISS',
      source: 'ITS 국가교통정보센터',
    });
    expect(missEnvelope.data.cameras).toHaveLength(2);
    expect(JSON.stringify(missEnvelope)).not.toContain('synthetic-its-key');
    expect(fetcher).toHaveBeenCalledTimes(4);

    const hitResponse = await runtime.handle(createRequest());
    const hitEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await hitResponse.json());
    expect(hitEnvelope.meta.cache).toBe('HIT');
    expect(hitEnvelope.data).toEqual(missEnvelope.data);
    expect(fetcher).toHaveBeenCalledTimes(4);

    const notModified = await runtime.handle(createRequest({ 'If-None-Match': etag?.replace('W/', '') ?? '' }));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('retains the last good atomic snapshot when ITS fails inside the stale window', async () => {
    let now = 1_785_360_000_000;
    let failProvider = false;
    let requestSequence = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (failProvider) {
        return new Response(null, { status: 503 });
      }
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const roadFixture =
        url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
      return new Response(
        JSON.stringify(url.searchParams.get('cctvType') === '3' ? roadFixture.still : roadFixture.live),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-cctv-stale-${requestSequence}`,
      createRequestId: () => `request-cctv-stale-${++requestSequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const createRequest = () =>
      withTrustedAdmissionSubject(
        new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38'),
        '203.0.113.92',
      );

    const missResponse = await runtime.handle(createRequest());
    const missEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await missResponse.json());
    failProvider = true;
    now += 10 * 60_000 + 1;
    const staleResponse = await runtime.handle(createRequest());
    const staleEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await staleResponse.json());

    expect(missEnvelope.meta.cache).toBe('MISS');
    expect(staleResponse.status).toBe(200);
    expect(staleEnvelope.data).toEqual(missEnvelope.data);
    expect(staleEnvelope.meta).toMatchObject({
      cache: 'STALE',
      fetchedAt: missEnvelope.meta.fetchedAt,
      source: 'ITS 국가교통정보센터',
    });
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it('negative-caches a valid atomic empty and keeps unknown CCTV paths at 404', async () => {
    let requestSequence = 0;
    const clock = () => 1_785_360_000_000;
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(emptyFixture), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const runtime = createProductionGatewayRuntime({
      clock,
      createCoordinationToken: () => 'coordination-cctv-empty',
      createRequestId: () => `request-cctv-empty-${++requestSequence}`,
      environment: { ITS_API_KEY: 'synthetic-its-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(clock),
      logWriter: () => undefined,
    });
    const createRequest = () =>
      withTrustedAdmissionSubject(
        new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38'),
        '203.0.113.93',
      );

    const missResponse = await runtime.handle(createRequest());
    const missEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await missResponse.json());
    const hitResponse = await runtime.handle(createRequest());
    const hitEnvelope = successEnvelopeSchema(cctvDataSchema).parse(await hitResponse.json());
    const unregisteredResponse = await runtime.handle(
      withTrustedAdmissionSubject(new Request('https://balance.test/api/cctv/unknown'), '203.0.113.93'),
    );

    expect(missEnvelope).toMatchObject({ data: { cameras: [] }, meta: { cache: 'MISS' } });
    expect(hitEnvelope).toMatchObject({ data: { cameras: [] }, meta: { cache: 'HIT' } });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(unregisteredResponse.status).toBe(404);
    await expect(unregisteredResponse.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('serves one bounded JPEG through the same coarse production runtime without CDN caching', async () => {
    const clock = () => 1_785_360_000_000;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === 'cctvsec.ktict.co.kr') {
        const response = new Response(jpegBytes.slice().buffer, {
          headers: {
            'content-length': String(jpegBytes.byteLength),
            'content-type': 'image/jpeg',
          },
        });
        Object.defineProperty(response, 'url', { value: stillUrl });
        return response;
      }
      const fixture = url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
      return new Response(JSON.stringify(fixture.still), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const runtime = createProductionGatewayRuntime({
      clock,
      createCoordinationToken: () => 'coordination-cctv-image-runtime',
      createRequestId: () => 'request-cctv-image-runtime',
      environment: { ITS_API_KEY: 'synthetic-its-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(clock),
      logWriter: () => undefined,
    });
    const request = withTrustedAdmissionSubject(
      new Request(
        `https://balance.test/api/cctv/image?cameraId=${encodeURIComponent(expresswayCameraId)}&bbox=126.5,37,127.5,38`,
      ),
      '203.0.113.94',
    );

    const response = await runtime.handle(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-length')).toBe(String(jpegBytes.byteLength));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();
    expect(runtime.getCdnMaxAgeSeconds('/api/cctv/image')).toBeUndefined();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpegBytes);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('sanitizes an initial provider failure from both the public envelope and gateway logs', async () => {
    const logs: string[] = [];
    const fetcher = vi.fn(async () => {
      throw new Error('raw-upstream-marker apiKey=synthetic-its-key');
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => 1_785_360_000_000,
      createCoordinationToken: () => 'coordination-cctv-failure',
      createRequestId: () => 'request-cctv-failure',
      environment: { ITS_API_KEY: 'synthetic-its-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => 1_785_360_000_000),
      logWriter: (line) => logs.push(line),
    });
    const response = await runtime.handle(
      withTrustedAdmissionSubject(
        new Request('https://balance.test/api/cctv/list?bbox=126.5,37,127.5,38'),
        '203.0.113.95',
      ),
    );
    const serialized = JSON.stringify([await response.json(), logs]);

    expect(response.status).toBe(502);
    expect(JSON.parse(serialized)[0]).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
    expect(serialized).not.toContain('synthetic-its-key');
    expect(serialized).not.toContain('raw-upstream-marker');
    expect(serialized).not.toContain('apiKey=');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
