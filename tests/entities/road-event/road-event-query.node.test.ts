// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as roadEventModule from '../../../src/entities/road-event';

const roadEvent = roadEventModule as Readonly<Record<string, unknown>>;
const generatedAt = Date.parse('2026-08-03T12:00:00+09:00');

const createEnvelope = (channel: 'incidents' | 'disasters') => ({
  data: {
    channel,
    events: [],
    generatedAt,
  },
  meta: {
    cache: 'MISS',
    fetchedAt: generatedAt,
    requestId: `road-events-${channel}-query`,
    source: 'ITS',
  },
});

type RoadEventQueryOptions = Readonly<{
  enabled: boolean;
  queryFn(context: Readonly<{ signal: AbortSignal }>): Promise<unknown>;
  queryKey: readonly unknown[];
  refetchInterval: number | false;
  staleTime: number;
}>;

type CreateRoadEventQueryOptions = (
  dependencies?: Readonly<{ enabled?: boolean; fetcher?: typeof fetch }>,
) => RoadEventQueryOptions;

describe('road event query options', () => {
  it('keeps the independent two-minute incidents query disabled until T30 activation', async () => {
    const createOptions = roadEvent.roadEventIncidentsQueryOptions as CreateRoadEventQueryOptions | undefined;
    const profile = roadEvent.ROAD_EVENT_INCIDENTS_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(createOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 2 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 2 * 60_000,
    });
    if (createOptions === undefined) {
      return;
    }

    const envelope = createEnvelope('incidents');
    const fetcher = vi.fn(async () => Response.json(envelope));
    const controller = new AbortController();
    const options = createOptions({ fetcher });

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(['road-events', 'incidents']);
    await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/road-events/incidents',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: controller.signal }),
    );
  });

  it('keeps the independent five-minute disasters query disabled until T30 activation', async () => {
    const createOptions = roadEvent.roadEventDisastersQueryOptions as CreateRoadEventQueryOptions | undefined;
    const profile = roadEvent.ROAD_EVENT_DISASTERS_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(createOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 5 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 5 * 60_000,
    });
    if (createOptions === undefined) {
      return;
    }

    const envelope = createEnvelope('disasters');
    const fetcher = vi.fn(async () => Response.json(envelope));
    const controller = new AbortController();
    const options = createOptions({ fetcher });

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(['road-events', 'disasters']);
    await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/road-events/disasters',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: controller.signal }),
    );
  });

  it('supports explicit activation without exposing provider parameters', () => {
    const incidents = roadEvent.roadEventIncidentsQueryOptions as CreateRoadEventQueryOptions | undefined;
    const disasters = roadEvent.roadEventDisastersQueryOptions as CreateRoadEventQueryOptions | undefined;

    expect(incidents).toBeTypeOf('function');
    expect(disasters).toBeTypeOf('function');
    if (incidents === undefined || disasters === undefined) {
      return;
    }

    expect(incidents({ enabled: true })).toMatchObject({ enabled: true, queryKey: ['road-events', 'incidents'] });
    expect(disasters({ enabled: true })).toMatchObject({ enabled: true, queryKey: ['road-events', 'disasters'] });
  });

  it('rejects a response whose channel does not match the requested endpoint', async () => {
    const incidents = roadEvent.roadEventIncidentsQueryOptions as CreateRoadEventQueryOptions | undefined;
    const disasters = roadEvent.roadEventDisastersQueryOptions as CreateRoadEventQueryOptions | undefined;

    expect(incidents).toBeTypeOf('function');
    expect(disasters).toBeTypeOf('function');
    if (incidents === undefined || disasters === undefined) {
      return;
    }

    const disasterFetcher = vi.fn(async () => Response.json(createEnvelope('disasters')));
    const incidentFetcher = vi.fn(async () => Response.json(createEnvelope('incidents')));
    const signal = new AbortController().signal;

    await expect(incidents({ enabled: true, fetcher: disasterFetcher }).queryFn({ signal })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(disasters({ enabled: true, fetcher: incidentFetcher }).queryFn({ signal })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
