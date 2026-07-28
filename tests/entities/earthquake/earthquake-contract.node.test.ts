// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as earthquakeModule from '../../../src/entities/earthquake';

const earthquake = earthquakeModule as Record<string, unknown>;
const DAY_MS = 24 * 60 * 60_000;
const snapshotTo = Date.parse('2026-07-28T03:00:00.000Z');
const snapshotFrom = snapshotTo - 7 * DAY_MS;
const kmaFrom = snapshotTo - 3 * DAY_MS;

const kmaSourceRef = {
  aliases: ['108:42:202607271235:1', '108:42:202607271245:2'],
  depthKm: 11,
  id: '108:42',
  intensity: '최대진도 III',
  latitude: 37.12,
  location: '충북 가상군 남남서쪽 9km 지역',
  longitude: 127.18,
  magnitude: 3.1,
  magnitudeType: null,
  occurredAt: Date.parse('2026-07-27T03:30:05.120Z'),
  provider: 'KMA',
  updatedAt: Date.parse('2026-07-27T03:45:00.000Z'),
} as const;

const usgsSourceRef = {
  aliases: ['alias-test-1', 'us-test-1'],
  depthKm: 10,
  id: 'us-test-1',
  intensity: null,
  latitude: 37.11,
  location: 'Synthetic Korea region',
  longitude: 127.19,
  magnitude: 3,
  magnitudeType: 'mb',
  occurredAt: Date.parse('2026-07-27T03:30:00.000Z'),
  provider: 'USGS',
  updatedAt: Date.parse('2026-07-27T03:31:00.000Z'),
} as const;

const eventFixture = {
  depthKm: kmaSourceRef.depthKm,
  id: 'kma:108:42',
  intensity: kmaSourceRef.intensity,
  latitude: kmaSourceRef.latitude,
  location: kmaSourceRef.location,
  longitude: kmaSourceRef.longitude,
  magnitude: kmaSourceRef.magnitude,
  magnitudeType: kmaSourceRef.magnitudeType,
  occurredAt: kmaSourceRef.occurredAt,
  sourceRefs: [kmaSourceRef, usgsSourceRef],
  updatedAt: kmaSourceRef.updatedAt,
} as const;

const snapshotFixture = {
  coverage: {
    maximumLatitude: 45,
    maximumLongitude: 145,
    minimumLatitude: 21,
    minimumLongitude: 110,
  },
  events: [eventFixture],
  sources: {
    kma: { from: kmaFrom, status: 'available', to: snapshotTo },
    usgs: { from: snapshotFrom, status: 'available', to: snapshotTo },
  },
  window: { from: snapshotFrom, to: snapshotTo },
} as const;

describe('earthquake transport contract', () => {
  it('accepts a strict source-aware regional snapshot', () => {
    const schema = earthquake.earthquakeDataSchema as
      | { parse: (input: unknown) => unknown; safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(snapshotFixture)).toEqual(snapshotFixture);
    expect(schema.safeParse({ ...snapshotFixture, providerMessage: 'must not escape' }).success).toBe(false);
  });

  it.each([
    {
      name: 'wrong fixed coverage',
      value: { ...snapshotFixture, coverage: { ...snapshotFixture.coverage, maximumLongitude: 146 } },
    },
    {
      name: 'wrong seven-day public window',
      value: { ...snapshotFixture, window: { from: snapshotFrom + 1, to: snapshotTo } },
    },
    {
      name: 'wrong three-day KMA source window',
      value: {
        ...snapshotFixture,
        sources: { ...snapshotFixture.sources, kma: { ...snapshotFixture.sources.kma, from: kmaFrom - 1 } },
      },
    },
    {
      name: 'event outside the approved bbox',
      value: {
        ...snapshotFixture,
        events: [{ ...eventFixture, longitude: 145.01 }],
      },
    },
    {
      name: 'no available source',
      value: {
        ...snapshotFixture,
        sources: {
          kma: { ...snapshotFixture.sources.kma, status: 'missing-credential' },
          usgs: { ...snapshotFixture.sources.usgs, status: 'unavailable' },
        },
      },
    },
    {
      name: 'credential state for the public USGS feed',
      value: {
        ...snapshotFixture,
        events: [{ ...eventFixture, sourceRefs: [kmaSourceRef] }],
        sources: {
          ...snapshotFixture.sources,
          usgs: { ...snapshotFixture.sources.usgs, status: 'missing-credential' },
        },
      },
    },
  ])('rejects $name', ({ value }) => {
    const schema = earthquake.earthquakeDataSchema as
      | { safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.safeParse(value).success).toBe(false);
  });

  it('preserves provider-native measurements and rejects duplicate provider refs', () => {
    const schema = earthquake.earthquakeDataSchema as
      | { parse: (input: unknown) => unknown; safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    const parsed = schema.parse(snapshotFixture) as typeof snapshotFixture;
    expect(parsed.events[0]?.sourceRefs).toEqual([kmaSourceRef, usgsSourceRef]);
    expect(
      schema.safeParse({
        ...snapshotFixture,
        events: [{ ...eventFixture, sourceRefs: [kmaSourceRef, { ...kmaSourceRef, id: '108:43' }] }],
      }).success,
    ).toBe(false);
  });

  it('requires deterministic event ordering by time, magnitude and id', () => {
    const schema = earthquake.earthquakeDataSchema as
      | { safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    const olderSource = {
      ...usgsSourceRef,
      aliases: ['older'],
      id: 'older',
      occurredAt: eventFixture.occurredAt - 60_000,
    };
    const older = {
      depthKm: olderSource.depthKm,
      id: 'usgs:older',
      intensity: olderSource.intensity,
      latitude: olderSource.latitude,
      location: olderSource.location,
      longitude: olderSource.longitude,
      magnitude: olderSource.magnitude,
      magnitudeType: olderSource.magnitudeType,
      occurredAt: olderSource.occurredAt,
      sourceRefs: [olderSource],
      updatedAt: olderSource.updatedAt,
    };
    expect(schema.safeParse({ ...snapshotFixture, events: [older, eventFixture] }).success).toBe(false);
    expect(schema.safeParse({ ...snapshotFixture, events: [eventFixture, older] }).success).toBe(true);
  });
});

describe('earthquake query options', () => {
  it('owns one cache key and a one-minute foreground cadence', () => {
    const optionsFactory = earthquake.earthquakeQueryOptions;
    const profile = earthquake.EARTHQUAKE_QUERY_PROFILE;

    expect(optionsFactory).toBeTypeOf('function');
    expect(profile).toBeDefined();
    if (typeof optionsFactory !== 'function' || profile === undefined) {
      return;
    }

    const options = optionsFactory() as Record<string, unknown>;
    expect(options.queryKey).toEqual(['earthquakes']);
    expect(profile).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      staleTime: 60_000,
    });
  });

  it('loads only /api/earthquake and validates the strict envelope', async () => {
    const envelope = {
      data: snapshotFixture,
      meta: {
        cache: 'MISS',
        fetchedAt: snapshotTo,
        requestId: 'earthquake-request-1',
        source: 'KMA+USGS',
      },
    } as const;
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(envelope), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    );
    const optionsFactory = earthquake.earthquakeQueryOptions;

    expect(optionsFactory).toBeTypeOf('function');
    if (typeof optionsFactory !== 'function') {
      return;
    }

    const options = optionsFactory({ fetcher }) as {
      queryFn?: (context: { signal: AbortSignal }) => Promise<unknown>;
    };
    const signal = new AbortController().signal;

    expect(options.queryFn).toBeTypeOf('function');
    if (typeof options.queryFn !== 'function') {
      return;
    }

    await expect(options.queryFn({ signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/earthquake',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal }),
    );
  });
});
