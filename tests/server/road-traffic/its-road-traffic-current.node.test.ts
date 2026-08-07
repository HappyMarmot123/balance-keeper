// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import * as itsProviderModule from '../../../src/server/providers/its';

const provider = itsProviderModule as Readonly<Record<string, unknown>>;
const successFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-current-success.json', import.meta.url), 'utf8'),
) as {
  body: { items: Record<string, unknown>[] | Record<string, unknown>; totalCount: number | string };
  header: { resultCode: number | string; resultMsg: string };
};
const bounds = {
  maximumLatitude: 37.6,
  maximumLongitude: 127.05,
  minimumLatitude: 37.5,
  minimumLongitude: 126.95,
} as const;
const jsonResponse = (input: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(input), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

type FetchCurrentTraffic = (options: {
  bounds: typeof bounds;
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}) => Promise<{ bounds: typeof bounds; segments: readonly Record<string, unknown>[] }>;

const getFetcher = (): FetchCurrentTraffic | undefined =>
  provider.fetchItsRoadTrafficCurrent as FetchCurrentTraffic | undefined;
const options = (fetcher: typeof fetch, signal = new AbortController().signal) => ({
  bounds,
  fetcher,
  serviceKey: 'synthetic-its-secret',
  signal,
});
const cloneFixture = () => structuredClone(successFixture);
const rows = (input: ReturnType<typeof cloneFixture>): Record<string, unknown>[] => {
  if (!Array.isArray(input.body.items)) throw new TypeError('fixture rows must be an array');
  return input.body.items;
};

describe('ITS road traffic current provider', () => {
  it('requests one canonical bbox and normalizes deterministic unit-neutral segments', async () => {
    const fetchCurrent = getFetcher();
    expect(fetchCurrent).toBeTypeOf('function');
    if (fetchCurrent === undefined) return;
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(successFixture));
    const requestOptions = options(fetcher);

    const snapshot = await fetchCurrent(requestOptions);

    expect(snapshot).toEqual({
      bounds,
      segments: [
        {
          directionCode: null,
          endNodeId: 'NODE-002',
          linkId: 'LINK-001',
          observedAtSource: '20260803151930',
          roadName: '합성로',
          speed: 42.5,
          speedUnit: 'provider-unspecified',
          startNodeId: 'NODE-001',
          travelTimeSeconds: 120.25,
        },
        {
          directionCode: 'up',
          endNodeId: null,
          linkId: 'LINK-002',
          observedAtSource: '20260803152000',
          roadName: '합성대로',
          speed: 0,
          speedUnit: 'provider-unspecified',
          startNodeId: null,
          travelTimeSeconds: 0,
        },
      ],
    });
    const [requestUrl, requestInit] = fetcher.mock.calls[0] ?? [];
    expect((requestUrl as URL).origin).toBe('https://openapi.its.go.kr:9443');
    expect((requestUrl as URL).pathname).toBe('/trafficInfo');
    expect(Object.fromEntries((requestUrl as URL).searchParams)).toEqual({
      apiKey: 'synthetic-its-secret',
      getType: 'json',
      maxX: '127.05',
      maxY: '37.6',
      minX: '126.95',
      minY: '37.5',
      type: 'all',
    });
    expect(requestInit).toMatchObject({
      credentials: 'omit',
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: requestOptions.signal,
    });
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-its-secret');
  });

  it('accepts observed empty arrays and a single row object without inventing pagination', async () => {
    const fetchCurrent = getFetcher();
    expect(fetchCurrent).toBeTypeOf('function');
    if (fetchCurrent === undefined) return;

    const empty = cloneFixture();
    empty.body.items = [];
    empty.body.totalCount = 0;
    await expect(fetchCurrent(options(async () => jsonResponse(empty)))).resolves.toEqual({ bounds, segments: [] });

    const single = cloneFixture();
    single.body.items = rows(single)[0] as Record<string, unknown>;
    single.body.totalCount = '1';
    await expect(fetchCurrent(options(async () => jsonResponse(single)))).resolves.toMatchObject({
      segments: [{ linkId: 'LINK-002' }],
    });
  });

  it('deduplicates exact link revisions but fails closed on conflicting link data', async () => {
    const fetchCurrent = getFetcher();
    expect(fetchCurrent).toBeTypeOf('function');
    if (fetchCurrent === undefined) return;
    const exact = cloneFixture();
    rows(exact).push(structuredClone(rows(exact)[0] as Record<string, unknown>));
    exact.body.totalCount = rows(exact).length;
    await expect(fetchCurrent(options(async () => jsonResponse(exact)))).resolves.toMatchObject({
      segments: [{ linkId: 'LINK-001' }, { linkId: 'LINK-002' }],
    });

    const conflict = cloneFixture();
    const conflicting = structuredClone(rows(conflict)[0] as Record<string, unknown>);
    conflicting.speed = '1';
    rows(conflict).push(conflicting);
    conflict.body.totalCount = rows(conflict).length;
    await expect(fetchCurrent(options(async () => jsonResponse(conflict)))).rejects.toThrowError(
      /ITS road traffic current/u,
    );
  });

  it.each([
    [
      'unknown row field',
      (input: ReturnType<typeof cloneFixture>) => ((rows(input)[0] as Record<string, unknown>).x = 1),
    ],
    [
      'blank link ID',
      (input: ReturnType<typeof cloneFixture>) => ((rows(input)[0] as Record<string, unknown>).linkId = ' '),
    ],
    [
      'invalid source calendar',
      (input: ReturnType<typeof cloneFixture>) =>
        ((rows(input)[0] as Record<string, unknown>).createdDate = '20260230120000'),
    ],
    [
      'negative speed',
      (input: ReturnType<typeof cloneFixture>) => ((rows(input)[0] as Record<string, unknown>).speed = '-1'),
    ],
    [
      'excess travel time',
      (input: ReturnType<typeof cloneFixture>) => ((rows(input)[0] as Record<string, unknown>).travelTime = '86400.01'),
    ],
    ['count mismatch', (input: ReturnType<typeof cloneFixture>) => (input.body.totalCount = 3)],
    ['provider error code', (input: ReturnType<typeof cloneFixture>) => (input.header.resultCode = 1)],
  ])('rejects %s', async (_label, mutate) => {
    const fetchCurrent = getFetcher();
    expect(fetchCurrent).toBeTypeOf('function');
    if (fetchCurrent === undefined) return;
    const input = cloneFixture();
    mutate(input);

    await expect(fetchCurrent(options(async () => jsonResponse(input)))).rejects.toThrowError(
      /ITS road traffic current/u,
    );
  });

  it('rejects missing credentials and honors a pre-aborted request before network access', async () => {
    const fetchCurrent = getFetcher();
    expect(fetchCurrent).toBeTypeOf('function');
    if (fetchCurrent === undefined) return;
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(successFixture));

    await expect(fetchCurrent({ ...options(fetcher), serviceKey: '   ' })).rejects.toThrowError(
      /credential is missing/u,
    );
    const controller = new AbortController();
    controller.abort(new DOMException('stop', 'AbortError'));
    await expect(fetchCurrent(options(fetcher, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['non-success status', () => jsonResponse({}, { status: 502 })],
    ['partial success status', () => jsonResponse(successFixture, { status: 206 })],
    ['wrong MIME', () => new Response('{}', { headers: { 'content-type': 'text/plain' } })],
    ['invalid JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } })],
    [
      'invalid UTF-8',
      () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }),
    ],
    [
      'declared oversize',
      () =>
        new Response('{}', {
          headers: { 'content-length': String(2 * 1_024 * 1_024 + 1), 'content-type': 'application/json' },
        }),
    ],
    [
      'streamed oversize',
      () => new Response('x'.repeat(2 * 1_024 * 1_024 + 1), { headers: { 'content-type': 'application/json' } }),
    ],
  ])('fails closed for transport %s', async (_label, createResponse) => {
    const fetchCurrent = getFetcher();
    expect(fetchCurrent).toBeTypeOf('function');
    if (fetchCurrent === undefined) return;
    await expect(fetchCurrent(options(async () => createResponse()))).rejects.toThrowError(/ITS road traffic current/u);
  });

  it('fails closed for direct or JSON-escaped credential reflection', async () => {
    const fetchCurrent = getFetcher();
    expect(fetchCurrent).toBeTypeOf('function');
    if (fetchCurrent === undefined) return;
    const serviceKey = 'S3CRET';
    const reflected = cloneFixture();
    (rows(reflected)[0] as Record<string, unknown>).roadName = serviceKey;

    await expect(fetchCurrent({ ...options(async () => jsonResponse(reflected)), serviceKey })).rejects.toThrowError(
      'ITS road traffic current response is invalid',
    );

    const escapedKey = [...serviceKey]
      .map((character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0')}`)
      .join('');
    const body = JSON.stringify(reflected).replace(`"${serviceKey}"`, `"${escapedKey}"`);
    expect(body).not.toContain(serviceKey);
    await expect(
      fetchCurrent({
        ...options(async () => new Response(body, { headers: { 'content-type': 'application/json' } })),
        serviceKey,
      }),
    ).rejects.toThrowError('ITS road traffic current response is invalid');
  });

  it('sanitizes thrown provider detail and rejects a changed final endpoint', async () => {
    const fetchCurrent = getFetcher();
    expect(fetchCurrent).toBeTypeOf('function');
    if (fetchCurrent === undefined) return;

    let caught: unknown;
    try {
      await fetchCurrent(
        options(async () => {
          throw new Error('apiKey=synthetic-its-secret raw-marker');
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain('synthetic-its-secret');
    expect((caught as Error).message).not.toContain('raw-marker');

    const redirected = jsonResponse(successFixture);
    Object.defineProperty(redirected, 'url', { value: 'https://example.com/trafficInfo' });
    await expect(fetchCurrent(options(async () => redirected))).rejects.toThrowError(/ITS road traffic current/u);

    await expect(
      fetchCurrent(
        options(async (request) => {
          const changedUrl = new URL(request as URL);
          changedUrl.searchParams.set('maxX', '127.04');
          const changedQuery = jsonResponse(successFixture);
          Object.defineProperty(changedQuery, 'url', { value: changedUrl.href });
          return changedQuery;
        }),
      ),
    ).rejects.toThrowError(/ITS road traffic current/u);
  });
});
