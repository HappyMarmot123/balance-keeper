// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as cctvEntity from '../../../src/entities/cctv';
import { cctvCameraIdSchema, createCctvStillImagePath, fetchCctvStillImage } from '../../../src/entities/cctv';

const reference = {
  bounds: {
    maximumLatitude: 38,
    maximumLongitude: 127.5,
    minimumLatitude: 37,
    minimumLongitude: 126.5,
  },
  cameraId: cctvCameraIdSchema.parse('its-cctv:abcdefghijklmnop'),
} as const;

const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0xff, 0xd9]);
const createBoundedJpeg = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
};

const createChunkedResponse = (
  chunks: readonly Uint8Array[],
  cancel: (reason?: unknown) => void = () => undefined,
  headers: HeadersInit = { 'content-type': 'image/jpeg' },
  closeWhenExhausted = true,
): Response => {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        const chunk = chunks[index];
        if (chunk === undefined) {
          if (closeWhenExhausted) {
            controller.close();
          }
          return;
        }
        index += 1;
        controller.enqueue(chunk);
      },
    }),
    { headers },
  );
};

describe('CCTV still-image public contract', () => {
  it('builds one canonical same-origin path from camera ID and canonical bounds', () => {
    const cameraId = cctvCameraIdSchema.parse('its-cctv:abcdefghijklmnop');

    expect(
      createCctvStillImagePath({
        bounds: {
          maximumLatitude: 38.00001,
          maximumLongitude: 127.50001,
          minimumLatitude: 37.00001,
          minimumLongitude: 126.50001,
        },
        cameraId,
      }),
    ).toBe('/api/cctv/image?cameraId=its-cctv%3Aabcdefghijklmnop&bbox=126.5,37,127.5,38');
  });

  it.each(['', 'camera-1', 'its-cctv:short', 'its-cctv:abcdefghijklmnop?src=https://attacker.test'])(
    'rejects malformed camera ID %j',
    (cameraId) => {
      expect(cctvCameraIdSchema.safeParse(cameraId).success).toBe(false);
    },
  );

  it('exposes an on-demand Blob loader for the bounded same-origin route', () => {
    expect(cctvEntity).toHaveProperty('fetchCctvStillImage');
  });

  it('loads one same-origin JPEG as a Blob with restrictive browser request policy', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(jpegBytes.slice().buffer, {
          headers: {
            'content-length': String(jpegBytes.byteLength),
            'content-type': 'image/jpeg',
          },
        }),
    );
    const signal = new AbortController().signal;

    const image = await fetchCctvStillImage(reference, { fetcher, signal });

    expect(image).toBeInstanceOf(Blob);
    expect(image.type).toBe('image/jpeg');
    expect(image.size).toBe(jpegBytes.byteLength);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpegBytes);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/cctv/image?cameraId=its-cctv%3Aabcdefghijklmnop&bbox=126.5,37,127.5,38',
      {
        credentials: 'omit',
        headers: { Accept: 'image/jpeg' },
        method: 'GET',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal,
      },
    );
  });

  it('maps a strict server JSON error envelope without exposing response internals', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', requestId: 'request-cctv-image' } }), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
          status: 404,
        }),
    );

    await expect(fetchCctvStillImage(reference, { fetcher })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      requestId: 'request-cctv-image',
      status: 404,
    });
  });

  it('cancels a non-JSON failure body before rejecting it', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel,
        start(controller) {
          controller.enqueue(new TextEncoder().encode('upstream unavailable'));
        },
      }),
      {
        headers: { 'content-type': 'text/plain' },
        status: 502,
      },
    );

    await expect(fetchCctvStillImage(reference, { fetcher: async () => response })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a JSON failure stream when it crosses the shared byte cap', async () => {
    const cancel = vi.fn();
    const bytes = new Uint8Array(512 * 1_024 + 1);
    let pulls = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          cancel,
          pull(controller) {
            if (pulls === 0) {
              pulls += 1;
              controller.enqueue(bytes);
              return;
            }
            controller.error(new Error('body should have been cancelled at the byte cap'));
          },
        },
        { highWaterMark: 0 },
      ),
      {
        headers: { 'content-type': 'application/json' },
        status: 502,
      },
    );

    await expect(fetchCctvStillImage(reference, { fetcher: async () => response })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'wrong MIME',
      new Response(jpegBytes.slice().buffer, {
        headers: { 'content-length': String(jpegBytes.byteLength), 'content-type': 'text/html' },
      }),
    ],
    [
      'wrong signature',
      new Response(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c]).buffer, {
        headers: { 'content-length': '5', 'content-type': 'image/jpeg' },
      }),
    ],
    [
      'oversized declaration',
      new Response(jpegBytes.slice().buffer, {
        headers: { 'content-length': String(512 * 1_024 + 1), 'content-type': 'image/jpeg' },
      }),
    ],
    [
      'partial content',
      new Response(jpegBytes.slice().buffer, {
        headers: { 'content-length': String(jpegBytes.byteLength), 'content-type': 'image/jpeg' },
        status: 206,
      }),
    ],
  ])('rejects a %s binary success response', async (_case, response) => {
    await expect(fetchCctvStillImage(reference, { fetcher: async () => response })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('accepts a content-length-free stream at the exact byte cap', async () => {
    const bytes = createBoundedJpeg(512 * 1_024);
    const response = createChunkedResponse([bytes.subarray(0, 300_000), bytes.subarray(300_000)]);

    const image = await fetchCctvStillImage(reference, { fetcher: async () => response });

    expect(image.size).toBe(bytes.byteLength);
  });

  it('cancels a content-length-free stream immediately after it crosses the byte cap', async () => {
    const cancel = vi.fn();
    const bytes = createBoundedJpeg(512 * 1_024 + 1);
    const response = createChunkedResponse(
      [bytes.subarray(0, 512 * 1_024), bytes.subarray(512 * 1_024)],
      cancel,
      undefined,
      false,
    );

    await expect(fetchCctvStillImage(reference, { fetcher: async () => response })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a declared length that does not match the streamed body', async () => {
    const response = createChunkedResponse([jpegBytes], undefined, {
      'content-length': String(jpegBytes.byteLength - 1),
      'content-type': 'image/jpeg',
    });

    await expect(fetchCctvStillImage(reference, { fetcher: async () => response })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('preserves a custom caller abort reason', async () => {
    const caller = new AbortController();
    const reason = new Error('viewer closed');
    caller.abort(reason);

    await expect(
      fetchCctvStillImage(reference, {
        fetcher: async () => {
          throw reason;
        },
        signal: caller.signal,
      }),
    ).rejects.toBe(reason);
  });
});
