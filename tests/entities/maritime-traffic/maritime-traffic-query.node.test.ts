// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as maritimeTrafficModule from '../../../src/entities/maritime-traffic';

const maritimeTraffic = maritimeTrafficModule as Readonly<Record<string, unknown>>;

const envelope = {
  data: {
    cells: [
      {
        densityPercent: 12.5,
        gridId: 'GRID-001',
        vesselCount: 3,
      },
    ],
    generatedAt: Date.parse('2026-07-31T06:30:00.000Z'),
  },
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-07-31T06:31:00.000Z'),
    requestId: 'maritime-traffic-query',
    source: 'KOMSA MTIS',
  },
} as const;

type MaritimeTrafficQueryOptions = Readonly<{
  enabled: boolean;
  queryFn(context: Readonly<{ signal: AbortSignal }>): Promise<unknown>;
  queryKey: readonly unknown[];
  refetchInterval: number | false;
  staleTime: number;
}>;

type CreateMaritimeTrafficQueryOptions = (
  dependencies?: Readonly<{
    enabled?: boolean;
    fetcher?: typeof fetch;
  }>,
) => MaritimeTrafficQueryOptions;

describe('maritime traffic query options', () => {
  it('stays disabled until a map consumer activates the five-minute aggregate query', async () => {
    const createOptions = maritimeTraffic.maritimeTrafficQueryOptions as CreateMaritimeTrafficQueryOptions | undefined;
    const profile = maritimeTraffic.MARITIME_TRAFFIC_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(createOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 5 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 5 * 60_000,
    });
    if (createOptions === undefined) {
      return;
    }

    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(envelope), { headers: { 'content-type': 'application/json' } }),
    );
    const options = createOptions({ fetcher });
    const controller = new AbortController();

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(['maritime-traffic']);
    await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/maritime-traffic',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      }),
    );
  });

  it('can be explicitly enabled without changing cache identity', () => {
    const createOptions = maritimeTraffic.maritimeTrafficQueryOptions as CreateMaritimeTrafficQueryOptions | undefined;

    expect(createOptions).toBeTypeOf('function');
    if (createOptions === undefined) {
      return;
    }

    expect(createOptions({ enabled: true })).toMatchObject({
      enabled: true,
      queryKey: ['maritime-traffic'],
    });
  });

  it('rejects an invalid success envelope at the client boundary', async () => {
    const createOptions = maritimeTraffic.maritimeTrafficQueryOptions as CreateMaritimeTrafficQueryOptions | undefined;

    expect(createOptions).toBeTypeOf('function');
    if (createOptions === undefined) {
      return;
    }

    const fetcher = vi.fn(async () =>
      Response.json({
        ...envelope,
        data: {
          ...envelope.data,
          cells: [{ ...envelope.data.cells[0], densityPercent: 101 }],
        },
      }),
    );

    await expect(
      createOptions({ enabled: true, fetcher }).queryFn({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
