// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as usgsModule from '../../../src/server/providers/usgs';

const fixturePath = resolve(import.meta.dirname, '../../fixtures/usgs/earthquake-success.json');
type UsgsFixture = {
  features: Array<{
    geometry: { coordinates: number[] };
    properties: { ids: string; time: number };
  }>;
  metadata: { count: number; status: number };
};
const readFixture = (): UsgsFixture => JSON.parse(readFileSync(fixturePath, 'utf8')) as UsgsFixture;
const usgs = usgsModule as Record<string, unknown>;
const sourceTo = Date.parse('2026-07-28T03:00:00.000Z');
const sourceFrom = sourceTo - 7 * 24 * 60 * 60_000;

describe('USGS earthquake provider', () => {
  it('maps coordinates, aliases and nullable measurements while filtering the fixed bbox', () => {
    const normalize = usgs.normalizeUsgsEarthquakeFeed;

    expect(normalize).toBeTypeOf('function');
    if (typeof normalize !== 'function') {
      return;
    }

    expect(normalize(readFixture(), { from: sourceFrom, to: sourceTo })).toEqual([
      {
        aliases: ['alias-test-1', 'us-test-1'],
        depthKm: 10,
        id: 'us-test-1',
        intensity: null,
        latitude: 37.11,
        location: 'Synthetic Korea region',
        longitude: 127.19,
        magnitude: 3,
        magnitudeType: 'mb',
        occurredAt: 1785123000000,
        provider: 'USGS',
        updatedAt: 1785123060000,
      },
      {
        aliases: ['us-test-2'],
        depthKm: -1.2,
        id: 'us-test-2',
        intensity: null,
        latitude: 35.8,
        location: null,
        longitude: 129.2,
        magnitude: null,
        magnitudeType: null,
        occurredAt: 1785119400000,
        provider: 'USGS',
        updatedAt: 1785119460000,
      },
    ]);
  });

  it.each([
    [
      'geometry order',
      (fixture: UsgsFixture) => {
        const feature = fixture.features[0];
        if (feature === undefined) {
          throw new TypeError('Synthetic USGS fixture requires one feature');
        }
        feature.geometry.coordinates = [37.11, 127.19, 10];
      },
    ],
    [
      'event time',
      (fixture: UsgsFixture) => {
        const feature = fixture.features[0];
        if (feature === undefined) {
          throw new TypeError('Synthetic USGS fixture requires one feature');
        }
        feature.properties.time = Number.NaN;
      },
    ],
    [
      'duplicate id alias',
      (fixture: UsgsFixture) => {
        const feature = fixture.features[0];
        if (feature === undefined) {
          throw new TypeError('Synthetic USGS fixture requires one feature');
        }
        feature.properties.ids = ',us-test-1,us-test-1,';
      },
    ],
    [
      'collection count',
      (fixture: UsgsFixture) => {
        fixture.metadata.count = 4;
      },
    ],
    [
      'collection status',
      (fixture: UsgsFixture) => {
        fixture.metadata.status = 503;
      },
    ],
  ])('rejects malformed %s data', (_case, mutate) => {
    const normalize = usgs.normalizeUsgsEarthquakeFeed;

    expect(normalize).toBeTypeOf('function');
    if (typeof normalize !== 'function') {
      return;
    }

    const fixture = readFixture();
    mutate(fixture);
    expect(() => normalize(fixture, { from: sourceFrom, to: sourceTo })).toThrow();
  });

  it('loads only the official 2.5+ weekly GeoJSON feed and forwards cancellation', async () => {
    const fetchRecords = usgs.fetchUsgsEarthquakeRecords;

    expect(fetchRecords).toBeTypeOf('function');
    if (typeof fetchRecords !== 'function') {
      return;
    }

    const signal = new AbortController().signal;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson');
      expect(init).toMatchObject({
        headers: { Accept: 'application/geo+json, application/json' },
        method: 'GET',
        redirect: 'error',
        signal,
      });
      return new Response(JSON.stringify(readFixture()), {
        headers: { 'content-type': 'application/geo+json' },
        status: 200,
      });
    });

    await expect(
      fetchRecords({
        fetcher,
        signal,
        window: { from: sourceFrom, to: sourceTo },
      }),
    ).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('preserves the original abort reason', async () => {
    const fetchRecords = usgs.fetchUsgsEarthquakeRecords;

    expect(fetchRecords).toBeTypeOf('function');
    if (typeof fetchRecords !== 'function') {
      return;
    }

    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(reason), { once: true });
      });
    });
    const pending = fetchRecords({
      fetcher,
      signal: controller.signal,
      window: { from: sourceFrom, to: sourceTo },
    });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});
