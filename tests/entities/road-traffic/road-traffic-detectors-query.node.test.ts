// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as roadTrafficModule from '../../../src/entities/road-traffic';

const roadTraffic = roadTrafficModule as Readonly<Record<string, unknown>>;
const envelope = {
  data: {
    detectors: [],
    generatedAt: Date.parse('2026-08-07T12:02:00+09:00'),
    occupancyUnit: 'provider-unspecified',
    sourceTimeBasis: 'provider-local-unspecified',
    speedUnit: 'provider-unspecified',
    volumeUnit: 'provider-unspecified',
  },
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-08-07T12:02:00+09:00'),
    requestId: 'road-traffic-detectors-query',
    source: 'ITS',
  },
} as const;

type DetectorQueryOptions = Readonly<{
  enabled: boolean;
  queryFn(context: Readonly<{ signal: AbortSignal }>): Promise<unknown>;
  queryKey: readonly unknown[];
  refetchInterval: number | false;
  staleTime: number;
}>;
type CreateDetectorQueryOptions = (
  dependencies?: Readonly<{ enabled?: boolean; fetcher?: typeof fetch }>,
) => DetectorQueryOptions;

describe('road traffic detector query options', () => {
  it('uses one disabled nationwide identity at the five-minute cadence', async () => {
    const createOptions = roadTraffic.roadTrafficDetectorQueryOptions as CreateDetectorQueryOptions | undefined;
    const profile = roadTraffic.ROAD_TRAFFIC_DETECTOR_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(createOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 5 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 5 * 60_000,
    });
    if (createOptions === undefined) return;

    const fetcher = vi.fn(async () => Response.json(envelope));
    const options = createOptions({ fetcher });
    const controller = new AbortController();
    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(['road-traffic', 'detectors']);
    await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/road-traffic/detectors',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: controller.signal }),
    );
    expect(createOptions({ enabled: true })).toMatchObject({ enabled: true });
  });
});
