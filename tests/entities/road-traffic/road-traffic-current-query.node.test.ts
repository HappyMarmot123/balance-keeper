// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as roadTrafficModule from '../../../src/entities/road-traffic';

const roadTraffic = roadTrafficModule as Readonly<Record<string, unknown>>;
type Bounds = Readonly<{
  maximumLatitude: number;
  maximumLongitude: number;
  minimumLatitude: number;
  minimumLongitude: number;
}>;
const bounds = {
  maximumLatitude: 37.6,
  maximumLongitude: 127.05,
  minimumLatitude: 37.5,
  minimumLongitude: 126.95,
} as const;
const envelope = {
  data: {
    bounds,
    segments: [],
  },
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-08-03T15:21:00+09:00'),
    requestId: 'road-traffic-current-query',
    source: 'ITS',
  },
} as const;

type CurrentQueryOptions = Readonly<{
  enabled: boolean;
  queryFn(context: Readonly<{ signal: AbortSignal }>): Promise<unknown>;
  queryKey: readonly unknown[];
  refetchInterval: number | false;
  staleTime: number;
}>;
type CreateCurrentQueryOptions = (
  bounds: Bounds,
  dependencies?: Readonly<{ enabled?: boolean; fetcher?: typeof fetch }>,
) => CurrentQueryOptions;

describe('road traffic current query options', () => {
  it('uses a canonical bbox identity and stays disabled at the official five-minute cadence', async () => {
    const createOptions = roadTraffic.roadTrafficCurrentQueryOptions as CreateCurrentQueryOptions | undefined;
    const profile = roadTraffic.ROAD_TRAFFIC_CURRENT_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(createOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 5 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 5 * 60_000,
    });
    if (createOptions === undefined) return;

    const fetcher = vi.fn(async () => Response.json(envelope, { headers: { 'content-type': 'application/json' } }));
    const options = createOptions(
      {
        maximumLatitude: 37.600_004,
        maximumLongitude: 127.050_004,
        minimumLatitude: 37.500_004,
        minimumLongitude: 126.950_004,
      },
      { fetcher },
    );
    const controller = new AbortController();

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(['road-traffic', 'current', 126.95, 37.5, 127.05, 37.6]);
    await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/road-traffic/current?bbox=126.95,37.5,127.05,37.6',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: controller.signal }),
    );
  });

  it('can be enabled explicitly and rejects a response for another bbox', async () => {
    const createOptions = roadTraffic.roadTrafficCurrentQueryOptions as CreateCurrentQueryOptions | undefined;
    expect(createOptions).toBeTypeOf('function');
    if (createOptions === undefined) return;

    expect(createOptions(bounds, { enabled: true })).toMatchObject({ enabled: true });
    const fetcher = vi.fn(async () =>
      Response.json({
        ...envelope,
        data: { ...envelope.data, bounds: { ...bounds, maximumLongitude: 127.04 } },
      }),
    );

    await expect(
      createOptions(bounds, { enabled: true, fetcher }).queryFn({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
