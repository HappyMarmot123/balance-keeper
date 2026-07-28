// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as earthquakeRouteModule from '../../../src/server/routes/earthquake';

const routeModule = earthquakeRouteModule as Record<string, unknown>;
const occurredAt = Date.parse('2026-07-27T03:30:00.000Z');

const kmaRecord = {
  aliases: ['108:42:202607271235:1'],
  depthKm: 11,
  id: '108:42',
  intensity: '최대진도 III',
  latitude: 37.12,
  location: '충북 가상군 남남서쪽 9km 지역',
  longitude: 127.18,
  magnitude: 3.1,
  magnitudeType: null,
  occurredAt: occurredAt + 5_000,
  provider: 'KMA',
  updatedAt: occurredAt + 15 * 60_000,
} as const;

const usgsRecord = {
  aliases: ['alias-test-1', 'us-test-1'],
  depthKm: 10,
  id: 'us-test-1',
  intensity: null,
  latitude: 37.11,
  location: 'Synthetic Korea region',
  longitude: 127.19,
  magnitude: 3,
  magnitudeType: 'mb',
  occurredAt,
  provider: 'USGS',
  updatedAt: occurredAt + 60_000,
} as const;

describe('earthquake reconciliation', () => {
  it('deduplicates only a close cross-source event and preserves both native records', () => {
    const reconcile = routeModule.reconcileEarthquakeRecords;

    expect(reconcile).toBeTypeOf('function');
    if (typeof reconcile !== 'function') {
      return;
    }

    expect(reconcile([kmaRecord], [usgsRecord])).toEqual([
      {
        depthKm: 11,
        id: 'kma:108:42',
        intensity: '최대진도 III',
        latitude: 37.12,
        location: '충북 가상군 남남서쪽 9km 지역',
        longitude: 127.18,
        magnitude: 3.1,
        magnitudeType: null,
        occurredAt: occurredAt + 5_000,
        sourceRefs: [kmaRecord, usgsRecord],
        updatedAt: occurredAt + 15 * 60_000,
      },
    ]);
  });

  it.each([
    ['time', { occurredAt: kmaRecord.occurredAt + 91_000, updatedAt: kmaRecord.occurredAt + 92_000 }],
    ['distance', { latitude: 37.72 }],
    ['magnitude', { magnitude: 3.81 }],
  ])('keeps events separate just outside the approved %s threshold', (_boundary, change) => {
    const reconcile = routeModule.reconcileEarthquakeRecords;

    expect(reconcile).toBeTypeOf('function');
    if (typeof reconcile !== 'function') {
      return;
    }

    const events = reconcile([kmaRecord], [{ ...usgsRecord, ...change }]);
    expect(events).toHaveLength(2);
    expect(events.flatMap((event: { sourceRefs: unknown[] }) => event.sourceRefs)).toHaveLength(2);
  });

  it('collapses a KMA correction to the latest notice while retaining revision aliases', () => {
    const reconcile = routeModule.reconcileEarthquakeRecords;

    expect(reconcile).toBeTypeOf('function');
    if (typeof reconcile !== 'function') {
      return;
    }

    const correction = {
      ...kmaRecord,
      aliases: ['108:42:202607271245:2'],
      location: '수정된 위치',
      magnitude: 3.2,
      updatedAt: kmaRecord.updatedAt + 60_000,
    };
    const events = reconcile([kmaRecord, correction], []);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      location: '수정된 위치',
      magnitude: 3.2,
      sourceRefs: [
        {
          aliases: ['108:42:202607271235:1', '108:42:202607271245:2'],
          id: '108:42',
          updatedAt: correction.updatedAt,
        },
      ],
    });
  });
});
