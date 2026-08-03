// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as roadTrafficModule from '../../../src/entities/road-traffic';

const roadTraffic = roadTrafficModule as Readonly<Record<string, unknown>>;
const envelope = {
  data: {
    forecastAt: Date.parse('2026-08-03T15:00:00+09:00'),
    sectionId: '1',
    segments: [
      {
        linkId: 'LINK-001',
        sectionTypeCode: 'M',
        speed: 80,
        speedUnit: 'provider-unspecified',
      },
    ],
  },
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-08-03T15:01:00+09:00'),
    requestId: 'road-traffic-forecast-query',
    source: 'ITS',
  },
} as const;

type ForecastQueryOptions = Readonly<{
  enabled: boolean;
  queryFn(context: Readonly<{ signal: AbortSignal }>): Promise<unknown>;
  queryKey: readonly unknown[];
  refetchInterval: number | false;
  staleTime: number;
}>;

type CreateForecastQueryOptions = (
  dependencies?: Readonly<{ enabled?: boolean; fetcher?: typeof fetch }>,
) => ForecastQueryOptions;

describe('road traffic forecast query options', () => {
  it('stays disabled until T30 activates the independent thirty-minute query', async () => {
    const createOptions = roadTraffic.roadTrafficForecastQueryOptions as CreateForecastQueryOptions | undefined;
    const profile = roadTraffic.ROAD_TRAFFIC_FORECAST_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(createOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 30 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 30 * 60_000,
    });
    if (createOptions === undefined) {
      return;
    }

    const fetcher = vi.fn(async () => Response.json(envelope, { headers: { 'content-type': 'application/json' } }));
    const options = createOptions({ fetcher });
    const controller = new AbortController();

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(['road-traffic', 'forecast']);
    await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/road-traffic/forecast',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      }),
    );
  });

  it('can be explicitly enabled without exposing provider request parameters', () => {
    const createOptions = roadTraffic.roadTrafficForecastQueryOptions as CreateForecastQueryOptions | undefined;
    expect(createOptions).toBeTypeOf('function');
    if (createOptions === undefined) {
      return;
    }

    expect(createOptions({ enabled: true })).toMatchObject({
      enabled: true,
      queryKey: ['road-traffic', 'forecast'],
    });
  });

  it('rejects a success envelope that invents a speed unit', async () => {
    const createOptions = roadTraffic.roadTrafficForecastQueryOptions as CreateForecastQueryOptions | undefined;
    expect(createOptions).toBeTypeOf('function');
    if (createOptions === undefined) {
      return;
    }

    const fetcher = vi.fn(async () =>
      Response.json({
        ...envelope,
        data: {
          ...envelope.data,
          segments: [{ ...envelope.data.segments[0], speedUnit: 'km/h' }],
        },
      }),
    );

    await expect(
      createOptions({ enabled: true, fetcher }).queryFn({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
