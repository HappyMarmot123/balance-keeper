// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import { createCctvLiveStreamRoute } from '../../../src/server/routes/cctv';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-success.json', import.meta.url), 'utf8'),
) as {
  expressway: { live: { response: { data: Array<{ cctvurl: string }> } } };
  nationalRoad: { live: unknown };
};

const cameraId = `its-cctv:${createHash('sha256')
  .update(JSON.stringify(['ex', '0010', '서울고속도로 CCTV', 127.01, 37.51]), 'utf8')
  .digest('base64url')
  .slice(0, 16)}`;

const liveUrl = successFixture.expressway.live.response.data[0]?.cctvurl;
if (liveUrl === undefined) {
  throw new TypeError('Expected an expressway live fixture row');
}
const manifestUrl = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-master-signature';

const createFetcher = () =>
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === 'cctvsec.ktict.co.kr') {
      expect(init?.redirect).toBe('manual');
      return new Response(null, { headers: { location: manifestUrl }, status: 302 });
    }
    const fixture = url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
    return new Response(JSON.stringify(fixture.live), {
      headers: { 'content-type': 'application/json' },
    });
  });

const createRoute = (fetcher = createFetcher(), serviceKey: string | undefined = 'synthetic-its-key') =>
  createCctvLiveStreamRoute({
    clock: () => 1_785_360_000_000,
    fetcher,
    readAdmissionSubject: () => createAdmissionSubject('opaque-cctv-live-client'),
    serviceKey,
  });

const path = `/api/cctv/stream?cameraId=${encodeURIComponent(cameraId)}&bbox=126.5,37,127.5,38`;

describe('CCTV fresh live stream route', () => {
  it('resolves a fresh type-4 source into a no-store gateway outcome', async () => {
    const fetcher = createFetcher();
    const route = createRoute(fetcher);
    const parsed = await route.parseRequest(new Request(`https://balance.test${path}`));

    expect(route.kind).toBe('no-store');
    expect(parsed.input).toEqual({
      bounds: {
        maximumLatitude: 38,
        maximumLongitude: 127.5,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
      },
      cameraId,
    });
    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toEqual({
      data: { url: manifestUrl },
      fetchedAt: 1_785_360_000_000,
      kind: 'value',
      source: 'ITS 국가교통정보센터',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.slice(0, 2).map(([input]) => {
        const url = new URL(input.toString());
        return [url.searchParams.get('type'), url.searchParams.get('cctvType')];
      }),
    ).toEqual([
      ['ex', '4'],
      ['its', '4'],
    ]);
  });

  it.each([
    '/api/cctv/stream',
    `/api/cctv/stream?cameraId=${encodeURIComponent(cameraId)}`,
    `/api/cctv/stream?cameraId=${encodeURIComponent(cameraId)}&bbox=126.5,37,127.5,38&src=${encodeURIComponent(liveUrl)}`,
    `/api/cctv/stream?cameraId=${encodeURIComponent(cameraId)}&cameraId=${encodeURIComponent(cameraId)}&bbox=126.5,37,127.5,38`,
    `/api/cctv/stream?cameraId=${encodeURIComponent(cameraId)}&bbox=126.5,37,127.5,38&bbox=126.5,37,127.5,38`,
  ])('rejects a non-canonical request before provider access: %s', async (requestPath) => {
    const fetcher = createFetcher();
    const route = createRoute(fetcher);

    await expect(
      Promise.resolve().then(() => route.parseRequest(new Request(`https://balance.test${requestPath}`))),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a valid but unknown camera ID to NOT_FOUND', async () => {
    const fetcher = createFetcher();
    const route = createRoute(fetcher);
    const parsed = await route.parseRequest(
      new Request('https://balance.test/api/cctv/stream?cameraId=its-cctv%3A________________&bbox=126.5,37,127.5,38'),
    );

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the initial media URL redirects outside the approved manifest boundary', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === 'cctvsec.ktict.co.kr') {
        return new Response(null, {
          headers: { location: 'https://example.com/live/master.m3u8' },
          status: 302,
        });
      }
      const fixture = url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
      return new Response(JSON.stringify(fixture.live), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const route = createRoute(fetcher);
    const parsed = await route.parseRequest(new Request(`https://balance.test${path}`));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('fails closed before provider access when the credential is missing', async () => {
    const fetcher = createFetcher();
    const route = createRoute(fetcher, '');
    const parsed = await route.parseRequest(new Request(`https://balance.test${path}`));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
