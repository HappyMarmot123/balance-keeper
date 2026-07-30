// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { CctvBounds } from '../../../src/entities/cctv/contract';
import {
  fetchItsCctvStillImage,
  fetchItsCctvStillMetadataById,
  ITS_CCTV_STILL_IMAGE_MAX_BYTES,
} from '../../../src/server/providers/its';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-success.json', import.meta.url), 'utf8'),
) as {
  expressway: { still: unknown };
  nationalRoad: { still: unknown };
};

const bounds = Object.freeze({
  maximumLatitude: 38,
  maximumLongitude: 127.5,
  minimumLatitude: 37,
  minimumLongitude: 126.5,
}) satisfies CctvBounds;

const stillUrl =
  'https://cctvsec.ktict.co.kr:8091/4003/QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==';

const expresswayCameraId = `its-cctv:${createHash('sha256')
  .update(JSON.stringify(['ex', '0010', '서울고속도로 CCTV', 127.01, 37.51]), 'utf8')
  .digest('base64url')
  .slice(0, 16)}`;

const createSyntheticJpeg = (width: number, height: number): Uint8Array =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x0c,
    0x03,
    0x01,
    0x00,
    0x02,
    0x00,
    0x03,
    0x00,
    0x00,
    0x3f,
    0x00,
    0x01,
    0xff,
    0xd9,
  ]);

const createImageResponse = (
  bytes: Uint8Array,
  url = stillUrl,
  options: Readonly<{ contentLength?: string | null; contentType?: string }> = {},
): Response => {
  const headers = new Headers({
    'content-type': options.contentType ?? 'image/jpeg',
  });
  if (options.contentLength !== null) {
    headers.set('content-length', options.contentLength ?? String(bytes.byteLength));
  }
  const response = new Response(bytes.slice().buffer, {
    headers,
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

const createPaddedJpeg = (size: number, width = 352, height = 288): Uint8Array => {
  const base = createSyntheticJpeg(width, height);
  const bytes = new Uint8Array(size);
  bytes.set(base.slice(0, -2));
  bytes.set(base.slice(-2), size - 2);
  return bytes;
};

describe('ITS CCTV bounded still-image provider', () => {
  it('resolves one camera ID from fresh type-3 metadata without requesting HLS inventory', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const fixture = url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
      return new Response(JSON.stringify(fixture.still), {
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await fetchItsCctvStillMetadataById({
      bounds,
      cameraId: expresswayCameraId,
      fetcher,
      serviceKey: 'synthetic-its-key',
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      cameraId: expresswayCameraId,
      url: stillUrl,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.map(([input]) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        return [url.searchParams.get('type'), url.searchParams.get('cctvType')];
      }),
    ).toEqual([
      ['ex', '3'],
      ['its', '3'],
    ]);
  });

  it('returns a fully validated bounded JPEG and its dimensions', async () => {
    const bytes = createSyntheticJpeg(352, 288);
    const fetcher = vi.fn(async () => createImageResponse(bytes));
    const signal = new AbortController().signal;

    const result = await fetchItsCctvStillImage({
      fetcher,
      signal,
      url: stillUrl,
    });

    expect(result).toEqual({
      bytes,
      height: 288,
      width: 352,
    });
    expect(fetcher).toHaveBeenCalledWith(stillUrl, {
      credentials: 'omit',
      headers: { Accept: 'image/jpeg' },
      method: 'GET',
      redirect: 'error',
      signal,
    });
  });

  it('distinguishes an unknown camera ID from an upstream transport failure', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const fixture = url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
      return new Response(JSON.stringify(fixture.still), {
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      fetchItsCctvStillMetadataById({
        bounds,
        cameraId: 'its-cctv:________________',
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: 'ItsCctvCameraNotFoundError' });
  });

  it('rejects duplicate fresh metadata instead of selecting the first rotating URL', async () => {
    const duplicatedExpressway = structuredClone(successFixture.expressway.still) as {
      response: { data: unknown[]; datacount: number };
    };
    const conflictingDuplicate = structuredClone(duplicatedExpressway.response.data[0]) as {
      cctvurl2: string;
    };
    conflictingDuplicate.cctvurl2 = conflictingDuplicate.cctvurl2.replace('/4003/', '/4004/');
    duplicatedExpressway.response.data.push(conflictingDuplicate);
    duplicatedExpressway.response.datacount = duplicatedExpressway.response.data.length;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const body = url.searchParams.get('type') === 'ex' ? duplicatedExpressway : successFixture.nationalRoad.still;
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      fetchItsCctvStillMetadataById({
        bounds,
        cameraId: expresswayCameraId,
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('duplicate');
  });

  it('accepts a missing Content-Length only after enforcing the actual stream cap', async () => {
    const bytes = createPaddedJpeg(ITS_CCTV_STILL_IMAGE_MAX_BYTES);
    const fetcher = vi.fn(async () => createImageResponse(bytes, stillUrl, { contentLength: null }));

    const result = await fetchItsCctvStillImage({
      fetcher,
      signal: new AbortController().signal,
      url: stillUrl,
    });

    expect(result.bytes.byteLength).toBe(ITS_CCTV_STILL_IMAGE_MAX_BYTES);
  });

  it('rejects a stream that exceeds the hard cap without relying on Content-Length', async () => {
    const bytes = createPaddedJpeg(ITS_CCTV_STILL_IMAGE_MAX_BYTES + 1);
    const fetcher = vi.fn(async () => createImageResponse(bytes, stillUrl, { contentLength: null }));

    await expect(
      fetchItsCctvStillImage({
        fetcher,
        signal: new AbortController().signal,
        url: stillUrl,
      }),
    ).rejects.toThrow('size exceeds');
  });

  it('rejects an oversized decoded dimension even when the JPEG bytes are small', async () => {
    const bytes = createSyntheticJpeg(4_097, 1);
    const fetcher = vi.fn(async () => createImageResponse(bytes));

    await expect(
      fetchItsCctvStillImage({
        fetcher,
        signal: new AbortController().signal,
        url: stillUrl,
      }),
    ).rejects.toThrow('dimensions');
  });

  it('cancels an invalid upstream response body before rejecting its headers', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(createSyntheticJpeg(1, 1));
      },
    });
    const response = new Response(body, {
      headers: { 'content-type': 'text/html' },
    });
    Object.defineProperty(response, 'url', { value: stillUrl });
    const fetcher = vi.fn(async () => response);

    await expect(
      fetchItsCctvStillImage({
        fetcher,
        signal: new AbortController().signal,
        url: stillUrl,
      }),
    ).rejects.toThrow('content type');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a partial-content response even when its bytes form a valid JPEG', async () => {
    const bytes = createSyntheticJpeg(352, 288);
    const response = new Response(bytes.slice().buffer, {
      headers: {
        'content-length': String(bytes.byteLength),
        'content-type': 'image/jpeg',
      },
      status: 206,
    });
    Object.defineProperty(response, 'url', { value: stillUrl });

    await expect(
      fetchItsCctvStillImage({
        fetcher: async () => response,
        signal: new AbortController().signal,
        url: stillUrl,
      }),
    ).rejects.toThrow('boundary');
  });

  it('rejects a fake SOF-only payload without an SOS scan', async () => {
    const fakeJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x01, 0x00, 0x01, 0xff, 0xd9]);
    const fetcher = vi.fn(async () => createImageResponse(fakeJpeg));

    await expect(
      fetchItsCctvStillImage({
        fetcher,
        signal: new AbortController().signal,
        url: stillUrl,
      }),
    ).rejects.toThrow('JPEG');
  });

  it.each([
    ['raw HTTP', stillUrl.replace('https:', 'http:')],
    ['host suffix', stillUrl.replace('cctvsec.ktict.co.kr', 'cctvsec.ktict.co.kr.attacker.test')],
    ['query', `${stillUrl}?token=caller-controlled`],
  ])('rejects a %s media URL before fetch', async (_case, url) => {
    const fetcher = vi.fn();

    await expect(
      fetchItsCctvStillImage({
        fetcher,
        signal: new AbortController().signal,
        url,
      }),
    ).rejects.toThrow('URL');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong MIME', { contentType: 'text/html' }, createSyntheticJpeg(1, 1)],
    ['wrong signature', {}, Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0xff, 0xd9])],
    ['declared mismatch', { contentLength: '999' }, createSyntheticJpeg(1, 1)],
  ])('rejects a %s response', async (_case, responseOptions, bytes) => {
    const fetcher = vi.fn(async () => createImageResponse(bytes, stillUrl, responseOptions));

    await expect(
      fetchItsCctvStillImage({
        fetcher,
        signal: new AbortController().signal,
        url: stillUrl,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
