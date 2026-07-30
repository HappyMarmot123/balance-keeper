// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import { createCctvStillImageRoute } from '../../../src/server/routes/cctv';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-success.json', import.meta.url), 'utf8'),
) as {
  expressway: { still: unknown };
  nationalRoad: { still: unknown };
};

const cameraId = `its-cctv:${createHash('sha256')
  .update(JSON.stringify(['ex', '0010', '서울고속도로 CCTV', 127.01, 37.51]), 'utf8')
  .digest('base64url')
  .slice(0, 16)}`;

const stillUrl =
  'https://cctvsec.ktict.co.kr:8091/4003/QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==';

const jpegBytes = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x20, 0x01, 0x60, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03,
  0x11, 0x00, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00, 0x01, 0xff, 0xd9,
]);

const createFetcher = () =>
  vi.fn(async (input: string | URL | Request) => {
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

const createRoute = (fetcher = createFetcher(), serviceKey: string | undefined = 'synthetic-its-key') =>
  createCctvStillImageRoute({
    clock: () => 1_785_360_000_000,
    fetcher,
    readAdmissionSubject: () => createAdmissionSubject('opaque-cctv-image-client'),
    serviceKey,
  });

const path = `/api/cctv/image?cameraId=${encodeURIComponent(cameraId)}&bbox=126.5,37,127.5,38`;

describe('CCTV bounded still-image route', () => {
  it('resolves fresh metadata and returns a bounded media outcome', async () => {
    const fetcher = createFetcher();
    const route = createRoute(fetcher);
    const parsed = await route.parseRequest(new Request(`https://balance.test${path}`));

    expect(parsed.input).toEqual({
      bounds: {
        maximumLatitude: 38,
        maximumLongitude: 127.5,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
      },
      cameraId,
    });
    const outcome = await route.load(parsed.input, new AbortController().signal);
    expect(outcome).toMatchObject({
      body: jpegBytes,
      contentType: 'image/jpeg',
      fetchedAt: 1_785_360_000_000,
      kind: 'media',
      source: 'ITS 국가교통정보센터',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    '/api/cctv/image',
    `/api/cctv/image?cameraId=${encodeURIComponent(cameraId)}`,
    `/api/cctv/image?cameraId=${encodeURIComponent(cameraId)}&bbox=126.5,37,127.5,38&src=${encodeURIComponent(stillUrl)}`,
    `/api/cctv/image?cameraId=${encodeURIComponent(cameraId)}&cameraId=${encodeURIComponent(cameraId)}&bbox=126.5,37,127.5,38`,
    `/api/cctv/image?cameraId=${encodeURIComponent(cameraId)}&bbox=126.5,37,127.5,38&bbox=126.5,37,127.5,38`,
  ])('rejects a non-canonical request before provider access: %s', async (requestPath) => {
    const fetcher = createFetcher();
    const route = createRoute(fetcher);

    await expect(
      Promise.resolve().then(() => route.parseRequest(new Request(`https://balance.test${requestPath}`))),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a valid but unknown camera ID to NOT_FOUND without fetching image bytes', async () => {
    const fetcher = createFetcher();
    const route = createRoute(fetcher);
    const unknownPath = '/api/cctv/image?cameraId=its-cctv%3A________________&bbox=126.5,37,127.5,38';
    const parsed = await route.parseRequest(new Request(`https://balance.test${unknownPath}`));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the server credential is missing', async () => {
    const route = createRoute(createFetcher(), '');
    const parsed = await route.parseRequest(new Request(`https://balance.test${path}`));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
  });
});
