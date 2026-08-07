// @vitest-environment node

import { describe, expect, it } from 'vitest';

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
const snapshot = {
  bounds,
  segments: [
    {
      directionCode: null,
      endNodeId: 'NODE-002',
      linkId: 'LINK-001',
      observedAtSource: '20260803152000',
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
      roadName: null,
      speed: 0,
      speedUnit: 'provider-unspecified',
      startNodeId: null,
      travelTimeSeconds: 0,
    },
  ],
} as const;

type CurrentSchema = Readonly<{ parse(input: unknown): typeof snapshot }>;
type CanonicalizeBounds = (input: Bounds) => Bounds;

describe('road traffic current entity contract', () => {
  it('publishes a strict bounded and unit-neutral snapshot', () => {
    const schema = roadTraffic.roadTrafficCurrentDataSchema as CurrentSchema | undefined;

    expect(schema).toBeDefined();
    expect(roadTraffic.ROAD_TRAFFIC_CURRENT_SPEED_UNIT).toBe('provider-unspecified');
    if (schema === undefined) return;

    expect(schema.parse(snapshot)).toEqual(snapshot);
    expect(() => schema.parse({ ...snapshot, provider: 'ITS' })).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        segments: [{ ...snapshot.segments[0], geometry: [[126.95, 37.5]] }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        segments: [{ ...snapshot.segments[0], speedUnit: 'km/h' }],
      }),
    ).toThrow();
  });

  it('canonicalizes Korean bbox coordinates and rejects broad or unordered scopes', () => {
    const canonicalize = roadTraffic.canonicalizeRoadTrafficCurrentBounds as CanonicalizeBounds | undefined;
    expect(canonicalize).toBeTypeOf('function');
    expect(roadTraffic.ROAD_TRAFFIC_CURRENT_MAX_BBOX_SPAN_DEGREES).toBe(0.1);
    if (canonicalize === undefined) return;

    expect(
      canonicalize({
        maximumLatitude: 37.600_004,
        maximumLongitude: 127.050_004,
        minimumLatitude: 37.500_004,
        minimumLongitude: 126.950_004,
      }),
    ).toEqual(bounds);

    for (const invalid of [
      { ...bounds, maximumLongitude: 127.0501 },
      { ...bounds, maximumLatitude: 37.6001 },
      { ...bounds, minimumLongitude: bounds.maximumLongitude },
      { ...bounds, minimumLatitude: bounds.maximumLatitude },
      { ...bounds, minimumLongitude: 123.99 },
      { ...bounds, maximumLatitude: Number.NaN },
    ]) {
      expect(() => canonicalize(invalid)).toThrow();
    }
  });

  it('requires deterministic unique links and bounded public values', () => {
    const schema = roadTraffic.roadTrafficCurrentDataSchema as CurrentSchema | undefined;
    expect(roadTraffic.ROAD_TRAFFIC_CURRENT_MAX_SEGMENTS).toBe(10_000);
    expect(roadTraffic.ROAD_TRAFFIC_CURRENT_MAX_SERIALIZED_BYTES).toBe(2 * 1_024 * 1_024);
    expect(schema).toBeDefined();
    if (schema === undefined) return;

    expect(() => schema.parse({ ...snapshot, segments: [] })).not.toThrow();
    expect(() => schema.parse({ ...snapshot, segments: [...snapshot.segments].reverse() })).toThrow();
    expect(() => schema.parse({ ...snapshot, segments: [snapshot.segments[0], snapshot.segments[0]] })).toThrow();

    for (const [field, value] of [
      ['linkId', ' LINK-001'],
      ['speed', -1],
      ['speed', 300.01],
      ['travelTimeSeconds', -1],
      ['travelTimeSeconds', 86_400.01],
      ['observedAtSource', '20260230120000'],
    ] as const) {
      expect(() =>
        schema.parse({
          ...snapshot,
          segments: [{ ...snapshot.segments[0], [field]: value }],
        }),
      ).toThrow();
    }

    const createSegments = (length: number, roadNameLength = 1) =>
      Array.from({ length }, (_, index) => ({
        ...snapshot.segments[0],
        linkId: `L${index.toString().padStart(5, '0')}`,
        roadName: 'R'.repeat(roadNameLength),
      }));
    expect(() => schema.parse({ ...snapshot, segments: createSegments(10_001) })).toThrow();
    expect(() => schema.parse({ ...snapshot, segments: createSegments(10_000, 200) })).toThrow();
  });
});
