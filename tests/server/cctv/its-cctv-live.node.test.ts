// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { CctvBounds } from '../../../src/entities/cctv/contract';
import {
  fetchItsCctvLiveMetadataById,
  ItsCctvCameraNotFoundError,
  resolveItsCctvLiveManifestUrl,
} from '../../../src/server/providers/its';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-success.json', import.meta.url), 'utf8'),
) as {
  expressway: { live: unknown };
  nationalRoad: { live: unknown };
};

const bounds: CctvBounds = {
  maximumLatitude: 38,
  maximumLongitude: 127.5,
  minimumLatitude: 37,
  minimumLongitude: 126.5,
};

const cameraId = `its-cctv:${createHash('sha256')
  .update(JSON.stringify(['ex', '0010', '서울고속도로 CCTV', 127.01, 37.51]), 'utf8')
  .digest('base64url')
  .slice(0, 16)}`;
const initialLiveUrl =
  'https://cctvsec.ktict.co.kr/4003/Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=';
const manifestUrl = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-master-signature';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });

const createFetcher = () =>
  vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const fixture = url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
    return jsonResponse(fixture.live);
  });

describe('ITS CCTV fresh live metadata', () => {
  it('resolves one stable camera ID using only two fresh type-4 requests', async () => {
    const fetcher = createFetcher();
    const expresswayLive = successFixture.expressway.live as {
      response: { data: Array<{ cctvurl: string }> };
    };
    const liveUrl = expresswayLive.response.data[0]?.cctvurl;
    if (liveUrl === undefined) {
      throw new TypeError('Expected an expressway live fixture row');
    }

    await expect(
      fetchItsCctvLiveMetadataById({
        bounds,
        cameraId,
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ cameraId, url: liveUrl });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.map(([input]) => {
        const url = new URL(input.toString());
        return {
          mediaType: url.searchParams.get('cctvType'),
          roadType: url.searchParams.get('type'),
        };
      }),
    ).toEqual([
      { mediaType: '4', roadType: 'ex' },
      { mediaType: '4', roadType: 'its' },
    ]);
  });

  it('rejects a valid but unknown camera ID after the bounded live inventory lookup', async () => {
    const fetcher = createFetcher();

    await expect(
      fetchItsCctvLiveMetadataById({
        bounds,
        cameraId: 'its-cctv:________________',
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ItsCctvCameraNotFoundError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('resolves only one approved manual redirect without reading HLS bytes', async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          headers: { location: manifestUrl },
          status: 302,
        }),
    );

    await expect(resolveItsCctvLiveManifestUrl({ fetcher, initialUrl: initialLiveUrl, signal })).resolves.toBe(
      manifestUrl,
    );
    expect(fetcher).toHaveBeenCalledWith(initialLiveUrl, {
      headers: { Accept: 'application/vnd.apple.mpegurl' },
      method: 'GET',
      redirect: 'manual',
      signal,
    });
  });

  it.each([
    new Response(null, { headers: { location: 'https://example.com/live/master.m3u8' }, status: 302 }),
    new Response(null, {
      headers: {
        location:
          'https://cctvsec.ktict.co.kr:8082/live/segment-1.ts?nimblesessionid=opaque-session&wmsAuthSign=opaque-signature',
      },
      status: 302,
    }),
    new Response(null, { status: 302 }),
    new Response('#EXTM3U', { status: 200 }),
  ])('rejects an unapproved or missing redirect target', async (response) => {
    const fetcher = vi.fn(async () => response);

    await expect(
      resolveItsCctvLiveManifestUrl({
        fetcher,
        initialUrl: initialLiveUrl,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('CCTV live manifest redirect was rejected');
  });
});
