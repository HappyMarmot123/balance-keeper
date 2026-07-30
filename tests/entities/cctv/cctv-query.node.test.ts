// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as cctvQuery from '../../../src/entities/cctv/api/cctvListQuery';

const bounds = {
  maximumLatitude: 38,
  maximumLongitude: 127.5,
  minimumLatitude: 37,
  minimumLongitude: 126.5,
} as const;

const envelope = {
  data: {
    bounds,
    cameras: [],
  },
  meta: {
    cache: 'MISS',
    fetchedAt: 1_785_360_000_000,
    requestId: 'request-cctv-query',
    source: 'ITS 국가교통정보센터',
  },
} as const;

describe('CCTV list query', () => {
  it('stays disabled until a map consumer activates the canonical bbox', async () => {
    const queryModule = cctvQuery as Readonly<Record<string, unknown>>;
    expect(queryModule.cctvListQueryOptions).toBeDefined();

    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(envelope), { headers: { 'content-type': 'application/json' } }),
    );
    const createOptions = queryModule.cctvListQueryOptions as (
      requestedBounds: typeof bounds,
      dependencies?: Readonly<{ fetcher?: typeof fetch }>,
    ) => {
      enabled: boolean;
      queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
      queryKey: readonly unknown[];
      refetchInterval: number | false;
      staleTime: number;
    };
    const options = createOptions(bounds, { fetcher });

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(['cctv-list', 126.5, 37, 127.5, 38]);
    expect(options.staleTime).toBe(10 * 60_000);
    expect(options.refetchInterval).toBe(10 * 60_000);

    const controller = new AbortController();
    await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/cctv/list?bbox=126.5,37,127.5,38',
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('can be explicitly enabled without changing the cache identity', () => {
    const queryModule = cctvQuery as Readonly<Record<string, unknown>>;
    expect(queryModule.cctvListQueryOptions).toBeDefined();
    const createOptions = queryModule.cctvListQueryOptions as (
      requestedBounds: typeof bounds,
      dependencies?: Readonly<{ enabled?: boolean }>,
    ) => { enabled: boolean; queryKey: readonly unknown[] };

    const options = createOptions(bounds, { enabled: true });
    expect(options.enabled).toBe(true);
    expect(options.queryKey).toEqual(['cctv-list', 126.5, 37, 127.5, 38]);
  });

  it('uses the same four-decimal bbox for the path, key and response contract', async () => {
    const requestedBounds = {
      maximumLatitude: 37.99996,
      maximumLongitude: 127.49996,
      minimumLatitude: 37.00004,
      minimumLongitude: 126.50004,
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(envelope), { headers: { 'content-type': 'application/json' } }),
    );
    const createOptions = (cctvQuery as Readonly<Record<string, unknown>>)
      .cctvListQueryOptions as typeof cctvQuery.cctvListQueryOptions;
    const options = createOptions(requestedBounds, { enabled: true, fetcher });

    expect(options.queryKey).toEqual(['cctv-list', 126.5, 37, 127.5, 38]);
    await expect(options.queryFn({ signal: new AbortController().signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith('/api/cctv/list?bbox=126.5,37,127.5,38', expect.any(Object));
  });

  it('rejects a valid envelope whose response bounds do not match the requested cache key', async () => {
    const mismatchedEnvelope = {
      ...envelope,
      data: {
        ...envelope.data,
        bounds: { ...envelope.data.bounds, minimumLongitude: 126.6 },
      },
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(mismatchedEnvelope), { headers: { 'content-type': 'application/json' } }),
    );
    const options = cctvQuery.cctvListQueryOptions(bounds, { enabled: true, fetcher });

    await expect(options.queryFn({ signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
