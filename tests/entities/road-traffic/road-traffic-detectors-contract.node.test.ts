// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as roadTrafficModule from '../../../src/entities/road-traffic';

const roadTraffic = roadTrafficModule as Readonly<Record<string, unknown>>;
const generatedAt = Date.parse('2026-08-07T12:02:00+09:00');
const snapshot = {
  detectors: [
    {
      detectorId: 'VDS-001',
      linkedRoadSegmentIds: ['1001', '1002'],
      observations: [
        [1, '20260807120000', 72.5, 18, 121],
        [0, '20260807120100', null, null, null],
      ],
    },
    {
      detectorId: 'VDS-002',
      linkedRoadSegmentIds: ['2001'],
      observations: [[2, '20260807120100', 48, 31, 17.5]],
    },
  ],
  generatedAt,
  occupancyUnit: 'provider-unspecified',
  sourceTimeBasis: 'provider-local-unspecified',
  speedUnit: 'provider-unspecified',
  volumeUnit: 'provider-unspecified',
} as const;

type DetectorSchema = Readonly<{ parse(input: unknown): typeof snapshot }>;

describe('road traffic detector entity contract', () => {
  it('publishes a strict bounded unit-neutral snapshot without inferred geometry', () => {
    const schema = roadTraffic.roadTrafficDetectorDataSchema as DetectorSchema | undefined;

    expect(schema).toBeDefined();
    expect(roadTraffic.ROAD_TRAFFIC_DETECTOR_METRIC_UNIT).toBe('provider-unspecified');
    expect(roadTraffic.ROAD_TRAFFIC_DETECTOR_SOURCE_TIME_BASIS).toBe('provider-local-unspecified');
    expect(roadTraffic.ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS).toBe(30_000);
    expect(roadTraffic.ROAD_TRAFFIC_DETECTOR_MAX_LINKS).toBe(25);
    expect(roadTraffic.ROAD_TRAFFIC_DETECTOR_MAX_SERIALIZED_BYTES).toBe(2.5 * 1_024 * 1_024);
    if (schema === undefined) return;

    expect(schema.parse(snapshot)).toEqual(snapshot);
    expect(() => schema.parse({ ...snapshot, provider: 'ITS' })).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        detectors: [{ ...snapshot.detectors[0], geometry: [127, 37.5] }],
      }),
    ).toThrow();
    expect(() => schema.parse({ ...snapshot, speedUnit: 'km/h' })).toThrow();
  });

  it('requires deterministic unique detector groups and observations', () => {
    const schema = roadTraffic.roadTrafficDetectorDataSchema as DetectorSchema | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) return;

    expect(() => schema.parse({ ...snapshot, detectors: [...snapshot.detectors].reverse() })).toThrow();
    expect(() => schema.parse({ ...snapshot, detectors: [snapshot.detectors[0], snapshot.detectors[0]] })).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        detectors: [
          {
            ...snapshot.detectors[0],
            observations: [snapshot.detectors[0].observations[0], snapshot.detectors[0].observations[0]],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        detectors: [
          {
            ...snapshot.detectors[0],
            observations: [...snapshot.detectors[0].observations].reverse(),
          },
        ],
      }),
    ).toThrow();
  });

  it('validates source-local timestamps, links, lanes and metric bounds without a percent assumption', () => {
    const schema = roadTraffic.roadTrafficDetectorDataSchema as DetectorSchema | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) return;

    expect(() => schema.parse(snapshot)).not.toThrow();
    const first = snapshot.detectors[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    for (const observations of [
      [[33, '20260807120000', 1, 1, 1]],
      [[1, '20260230120000', 1, 1, 1]],
      [[1, '20260807120000', -1, 1, 1]],
      [[1, '20260807120000', 301, 1, 1]],
      [[1, '20260807120000', 1, -1, 1]],
      [[1, '20260807120000', 1, 1, -1]],
    ] as const) {
      expect(() => schema.parse({ ...snapshot, detectors: [{ ...first, observations }] })).toThrow();
    }
    expect(() =>
      schema.parse({ ...snapshot, detectors: [{ ...first, linkedRoadSegmentIds: ['1001', '1001'] }] }),
    ).toThrow();
    expect(() => schema.parse({ ...snapshot, detectors: [{ ...first, linkedRoadSegmentIds: [' 1001'] }] })).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        detectors: [{ ...first, observations: [[1, '20260807120000', 1, 1, -0.5]] }],
      }),
    ).not.toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        detectors: [
          {
            ...first,
            linkedRoadSegmentIds: Array.from({ length: 26 }, (_, index) => String(index + 1)),
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects observation-count and serialized-size overflow instead of truncating', () => {
    const schema = roadTraffic.roadTrafficDetectorDataSchema as DetectorSchema | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) return;
    const first = snapshot.detectors[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const tooMany = Array.from({ length: 15_001 }, (_, index) => [
      index % 33,
      `20260807${String(Math.floor(index / 3_600) % 24).padStart(2, '0')}${String(Math.floor(index / 60) % 60).padStart(2, '0')}${String(index % 60).padStart(2, '0')}`,
      1,
      1,
      1,
    ]);
    expect(() =>
      schema.parse({
        ...snapshot,
        detectors: [
          { ...first, observations: tooMany },
          { ...first, detectorId: 'VDS-003', linkedRoadSegmentIds: ['3001'], observations: tooMany },
        ],
      }),
    ).toThrow();

    const large = Array.from({ length: 2_000 }, (_, index) => ({
      detectorId: `V${index.toString().padStart(5, '0')}`,
      linkedRoadSegmentIds: Array.from(
        { length: 25 },
        (_, linkIndex) => `${index}`.padStart(32, '9') + `${linkIndex}`.padStart(32, '8'),
      ),
      observations: [[0, '20260807120000', 1, 1_000_000_000, 1_000_000_000]],
    }));
    expect(() => schema.parse({ ...snapshot, detectors: large })).toThrow();
  });
});
