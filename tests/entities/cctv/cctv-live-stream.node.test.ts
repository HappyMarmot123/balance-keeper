// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  type CctvLiveStreamReference,
  createCctvLiveStreamPath,
  fetchCctvLiveSource,
} from '../../../src/entities/cctv';

const reference: CctvLiveStreamReference = {
  bounds: {
    maximumLatitude: 38.00001,
    maximumLongitude: 127.50001,
    minimumLatitude: 37.00001,
    minimumLongitude: 126.50001,
  },
  cameraId: 'its-cctv:abcdefghijklmnop',
};

const manifestUrl = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-master-signature';

describe('CCTV live stream entity API', () => {
  it('creates a canonical same-origin source path without a cached provider URL', () => {
    const path = createCctvLiveStreamPath(reference);

    expect(path).toBe('/api/cctv/stream?cameraId=its-cctv%3Aabcdefghijklmnop&bbox=126.5,37,127.5,38');
    expect(path).not.toContain('cctvsec.ktict.co.kr');
  });

  it('fetches and validates one fresh live source envelope', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { url: manifestUrl },
            meta: {
              cache: 'MISS',
              fetchedAt: 1_785_360_000_000,
              requestId: 'request-cctv-live-1',
              source: 'ITS 국가교통정보센터',
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );

    await expect(fetchCctvLiveSource(reference, { fetcher })).resolves.toEqual({ url: manifestUrl });
    expect(fetcher).toHaveBeenCalledWith(createCctvLiveStreamPath(reference), {
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      signal: undefined,
    });
  });
});
