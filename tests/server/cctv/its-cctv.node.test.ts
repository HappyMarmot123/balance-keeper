// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { CctvBounds } from '../../../src/entities/cctv/contract';
import { fetchItsCctvList, ItsCctvProviderError, readItsCredential } from '../../../src/server/providers/its/cctvList';

const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-success.json', import.meta.url), 'utf8'),
) as {
  expressway: { live: unknown; still: unknown };
  nationalRoad: { live: unknown; still: unknown };
};
const emptyFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/cctv-empty.json', import.meta.url), 'utf8'),
) as unknown;

const bounds: CctvBounds = {
  maximumLatitude: 38,
  maximumLongitude: 127.5,
  minimumLatitude: 37,
  minimumLongitude: 126.5,
};
const expresswayLiveUrl =
  'https://cctvsec.ktict.co.kr/4003/Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=';
const expresswayStillUrl =
  'https://cctvsec.ktict.co.kr:8091/4003/QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==';
const nationalRoadLiveUrl =
  'https://cctvsec.ktict.co.kr/4004/REREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREQ=';
const nationalRoadStillUrl =
  'https://cctvsec.ktict.co.kr:8091/4004/QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQg==';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

describe('ITS CCTV metadata provider', () => {
  it('atomically merges the four approved metadata requests into safe HTTPS cameras', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const roadType = url.searchParams.get('type');
      const mediaType = url.searchParams.get('cctvType');
      const roadFixture = roadType === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
      return jsonResponse(mediaType === '3' ? roadFixture.still : roadFixture.live);
    });
    const snapshot = await fetchItsCctvList({
      bounds,
      fetcher,
      serviceKey: 'synthetic-its-key',
      signal: new AbortController().signal,
    });

    expect(fetcher).toHaveBeenCalledTimes(4);
    const requestUrls = fetcher.mock.calls.map(([input]) => new URL(input.toString()));
    expect(
      requestUrls.map((url) => ({
        cctvType: url.searchParams.get('cctvType'),
        host: url.host,
        key: url.searchParams.get('apiKey'),
        pathname: url.pathname,
        roadType: url.searchParams.get('type'),
      })),
    ).toEqual([
      {
        cctvType: '3',
        host: 'openapi.its.go.kr:9443',
        key: 'synthetic-its-key',
        pathname: '/cctvInfo',
        roadType: 'ex',
      },
      {
        cctvType: '3',
        host: 'openapi.its.go.kr:9443',
        key: 'synthetic-its-key',
        pathname: '/cctvInfo',
        roadType: 'its',
      },
      {
        cctvType: '4',
        host: 'openapi.its.go.kr:9443',
        key: 'synthetic-its-key',
        pathname: '/cctvInfo',
        roadType: 'ex',
      },
      {
        cctvType: '4',
        host: 'openapi.its.go.kr:9443',
        key: 'synthetic-its-key',
        pathname: '/cctvInfo',
        roadType: 'its',
      },
    ]);

    expect(snapshot.bounds).toEqual(bounds);
    expect(snapshot.cameras).toHaveLength(2);
    expect(snapshot.cameras).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^its-cctv:[A-Za-z0-9_-]{16}$/u),
        media: {
          liveHls: {
            createdAt: null,
            resolution: null,
            url: expresswayLiveUrl,
          },
          stillImage: {
            createdAt: null,
            resolution: null,
            url: expresswayStillUrl,
          },
        },
        roadSectionId: '0010',
        roadType: 'expressway',
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^its-cctv:[A-Za-z0-9_-]{16}$/u),
        media: {
          liveHls: {
            createdAt: null,
            resolution: null,
            url: nationalRoadLiveUrl,
          },
          stillImage: {
            createdAt: null,
            resolution: null,
            url: nationalRoadStillUrl,
          },
        },
        roadSectionId: null,
        roadType: 'national-road',
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-its-key');
    expect(JSON.stringify(snapshot)).not.toContain('http://');
  });

  it.each([
    {
      name: 'an unapproved MIME type',
      response: (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'text/html' } }),
    },
    {
      name: 'an oversized declared body',
      response: (body: unknown) =>
        jsonResponse(body, {
          headers: {
            'content-length': String(1024 * 1024 + 1),
            'content-type': 'application/json',
          },
        }),
    },
    {
      name: 'a redirected final response',
      response: (body: unknown) => {
        const response = jsonResponse(body);
        Object.defineProperties(response, {
          redirected: { value: true },
          url: { value: 'https://example.com/redirected' },
        });
        return response;
      },
    },
  ])('rejects $name before accepting provider data', async ({ response }) => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const roadFixture =
        url.searchParams.get('type') === 'ex' ? successFixture.expressway : successFixture.nationalRoad;
      const body = url.searchParams.get('cctvType') === '3' ? roadFixture.still : roadFixture.live;
      return response(body);
    });

    await expect(
      fetchItsCctvList({
        bounds,
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ItsCctvProviderError);
  });

  it('stops reading a streamed body after one MiB', async () => {
    const oversizedJson = JSON.stringify(successFixture.expressway.still) + ' '.repeat(1024 * 1024);
    const fetcher = vi.fn(async () => new Response(oversizedJson, { headers: { 'content-type': 'application/json' } }));

    await expect(
      fetchItsCctvList({
        bounds,
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/size/i);
  });

  it('treats four successful omitted-data responses as one empty snapshot', async () => {
    const fetcher = vi.fn(async () => jsonResponse(emptyFixture));

    await expect(
      fetchItsCctvList({
        bounds,
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ bounds, cameras: [] });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    {
      name: 'a mismatched row count',
      mutate(fixtures: typeof successFixture) {
        const still = fixtures.expressway.still as {
          response: { datacount: number };
        };
        still.response.datacount = 2;
      },
    },
    {
      name: 'a camera outside the requested bbox',
      mutate(fixtures: typeof successFixture) {
        const still = fixtures.expressway.still as {
          response: { data: Array<{ coordx: number }> };
        };
        const row = still.response.data[0];
        if (row === undefined) {
          throw new TypeError('Expected an expressway still fixture row');
        }
        row.coordx = 128;
      },
    },
    {
      name: 'an unsafe still metadata URL',
      mutate(fixtures: typeof successFixture) {
        const still = fixtures.expressway.still as {
          response: { data: Array<{ cctvurl2: string }> };
        };
        const row = still.response.data[0];
        if (row === undefined) {
          throw new TypeError('Expected an expressway still fixture row');
        }
        row.cctvurl2 = 'https://example.com/still';
      },
    },
    {
      name: 'an unsafe discarded HTTP still URL',
      mutate(fixtures: typeof successFixture) {
        const still = fixtures.expressway.still as {
          response: { data: Array<{ cctvurl: string }> };
        };
        const row = still.response.data[0];
        if (row === undefined) {
          throw new TypeError('Expected an expressway still fixture row');
        }
        row.cctvurl = 'http://example.com:8090/still';
      },
    },
    {
      name: 'a credential-like media query',
      mutate(fixtures: typeof successFixture) {
        const live = fixtures.expressway.live as {
          response: { data: Array<{ cctvurl: string }> };
        };
        const row = live.response.data[0];
        if (row === undefined) {
          throw new TypeError('Expected an expressway live fixture row');
        }
        row.cctvurl = `${expresswayLiveUrl}?token=must-not-cross`;
      },
    },
    {
      name: 'an encoded traversal media path',
      mutate(fixtures: typeof successFixture) {
        const live = fixtures.expressway.live as {
          response: { data: Array<{ cctvurl: string }> };
        };
        const row = live.response.data[0];
        if (row === undefined) {
          throw new TypeError('Expected an expressway live fixture row');
        }
        row.cctvurl = 'https://cctvsec.ktict.co.kr/fixture/%2e%2e/private.m3u8';
      },
    },
    {
      name: 'different still and live inventories',
      mutate(fixtures: typeof successFixture) {
        const live = fixtures.expressway.live as {
          response: { data: Array<{ cctvname: string }> };
        };
        const row = live.response.data[0];
        if (row === undefined) {
          throw new TypeError('Expected an expressway live fixture row');
        }
        row.cctvname = '다른 CCTV';
      },
    },
  ])('rejects $name atomically', async ({ mutate }) => {
    const fixtures = structuredClone(successFixture);
    mutate(fixtures);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const roadFixture = url.searchParams.get('type') === 'ex' ? fixtures.expressway : fixtures.nationalRoad;
      return jsonResponse(url.searchParams.get('cctvType') === '3' ? roadFixture.still : roadFixture.live);
    });

    await expect(
      fetchItsCctvList({
        bounds,
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ItsCctvProviderError);
  });

  it('keeps the observed 483-row inventory inside the approved provider limit', async () => {
    const fixture = structuredClone(successFixture.nationalRoad) as {
      live: { response: { data: Array<Record<string, unknown>>; datacount: number } };
      still: { response: { data: Array<Record<string, unknown>>; datacount: number } };
    };
    const stillSeed = fixture.still.response.data[0] ?? {};
    const liveSeed = fixture.live.response.data[0] ?? {};
    fixture.still.response.data = Array.from({ length: 483 }, (_, index) => ({
      ...stillSeed,
      cctvname: `국도 CCTV ${index}`,
      coordx: 126.51 + (index % 20) * 0.01,
      coordy: 37.01 + Math.floor(index / 20) * 0.01,
    }));
    fixture.live.response.data = Array.from({ length: 483 }, (_, index) => ({
      ...liveSeed,
      cctvname: `국도 CCTV ${index}`,
      coordx: 126.51 + (index % 20) * 0.01,
      coordy: 37.01 + Math.floor(index / 20) * 0.01,
    }));
    fixture.still.response.datacount = 483;
    fixture.live.response.datacount = 483;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('type') === 'ex') {
        return jsonResponse(emptyFixture);
      }
      return jsonResponse(url.searchParams.get('cctvType') === '3' ? fixture.still : fixture.live);
    });

    const snapshot = await fetchItsCctvList({
      bounds,
      fetcher,
      serviceKey: 'synthetic-its-key',
      signal: new AbortController().signal,
    });
    expect(snapshot.cameras).toHaveLength(483);
    expect(new Set(snapshot.cameras.map((camera) => camera.id))).toHaveProperty('size', 483);
  });

  it('aborts the three sibling metadata requests after the first atomic failure', async () => {
    const parentController = new AbortController();
    let siblingAbortCount = 0;
    const fetcher = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('type') === 'ex' && url.searchParams.get('cctvType') === '3') {
        return Promise.resolve(new Response(null, { status: 503 }));
      }

      return new Promise<Response>((resolve) => {
        const signal = init?.signal;
        signal?.addEventListener(
          'abort',
          () => {
            siblingAbortCount += 1;
            resolve(jsonResponse(emptyFixture));
          },
          { once: true },
        );
        setTimeout(() => resolve(jsonResponse(emptyFixture)), 50);
      });
    });

    await expect(
      fetchItsCctvList({
        bounds,
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: parentController.signal,
      }),
    ).rejects.toBeInstanceOf(ItsCctvProviderError);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(siblingAbortCount).toBe(3);
    expect(parentController.signal.aborted).toBe(false);
  });

  it('preserves an existing abort reason without starting a request', async () => {
    const controller = new AbortController();
    const reason = new Error('synthetic CCTV deadline');
    controller.abort(reason);
    const fetcher = vi.fn(async () => jsonResponse(emptyFixture));

    await expect(
      fetchItsCctvList({
        bounds,
        fetcher,
        serviceKey: 'synthetic-its-key',
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads only the canonical trimmed ITS credential identifier', () => {
    expect(readItsCredential({ ITS_API_KEY: '  synthetic-its-key  ' })).toBe('synthetic-its-key');
    expect(readItsCredential({ ITS_API_KEY: '   ' })).toBeUndefined();
    expect(readItsCredential({ DATA_GO_KR_SERVICE_KEY: 'different-provider-key' })).toBeUndefined();
  });
});
