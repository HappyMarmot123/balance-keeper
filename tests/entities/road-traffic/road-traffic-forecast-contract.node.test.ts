// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as roadTrafficModule from '../../../src/entities/road-traffic';

const roadTraffic = roadTrafficModule as Record<string, unknown>;
const forecastAt = Date.parse('2026-08-03T15:00:00+09:00');
const snapshot = {
  forecastAt,
  sectionId: '1',
  segments: [
    {
      linkId: 'LINK-001',
      sectionTypeCode: 'D',
      speed: 72.5,
      speedUnit: 'provider-unspecified',
    },
    {
      linkId: 'LINK-002',
      sectionTypeCode: 'M',
      speed: 80,
      speedUnit: 'provider-unspecified',
    },
  ],
} as const;

type ForecastSchema = Readonly<{ parse(input: unknown): typeof snapshot }>;

describe('road traffic forecast entity contract', () => {
  it('publishes a strict unit-neutral forecast snapshot', () => {
    const schema = roadTraffic.roadTrafficForecastDataSchema as ForecastSchema | undefined;

    expect(schema).toBeDefined();
    expect(roadTraffic.ROAD_TRAFFIC_FORECAST_SPEED_UNIT).toBe('provider-unspecified');
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(snapshot)).toEqual(snapshot);
    expect(() => schema.parse({ ...snapshot, provider: 'ITS' })).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        segments: [{ ...snapshot.segments[0], lengthMeters: 1_000 }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        segments: [{ ...snapshot.segments[0], speedUnit: 'km/h' }],
      }),
    ).toThrow();
  });

  it('requires canonical identifiers, provider codes and deterministic composite order', () => {
    const schema = roadTraffic.roadTrafficForecastDataSchema as ForecastSchema | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    for (const sectionId of ['', ' ', ' 1', '1 ']) {
      expect(() => schema.parse({ ...snapshot, sectionId })).toThrow();
    }
    for (const linkId of ['', ' ', ' LINK-001', 'LINK-001 ']) {
      expect(() => schema.parse({ ...snapshot, segments: [{ ...snapshot.segments[0], linkId }] })).toThrow();
    }
    for (const sectionTypeCode of ['', 'main', 'm', 'X']) {
      expect(() => schema.parse({ ...snapshot, segments: [{ ...snapshot.segments[0], sectionTypeCode }] })).toThrow();
    }

    expect(() => schema.parse({ ...snapshot, segments: [snapshot.segments[0], snapshot.segments[0]] })).toThrow();
    expect(() => schema.parse({ ...snapshot, segments: [...snapshot.segments].reverse() })).toThrow();
  });

  it('bounds time, speed, cardinality, identifier length and serialized bytes', () => {
    const schema = roadTraffic.roadTrafficForecastDataSchema as ForecastSchema | undefined;
    expect(roadTraffic.ROAD_TRAFFIC_FORECAST_MAX_SEGMENTS).toBe(1_000);
    expect(roadTraffic.ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH).toBe(64);
    expect(roadTraffic.ROAD_TRAFFIC_FORECAST_MAX_SERIALIZED_BYTES).toBe(128 * 1024);
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() => schema.parse({ ...snapshot, segments: [] })).not.toThrow();
    for (const invalidForecastAt of [-1, forecastAt + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => schema.parse({ ...snapshot, forecastAt: invalidForecastAt })).toThrow();
    }
    for (const speed of [-0.01, 300.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => schema.parse({ ...snapshot, segments: [{ ...snapshot.segments[0], speed }] })).toThrow();
    }

    const createSegments = (length: number, idWidth: number) =>
      Array.from({ length }, (_, index) => ({
        linkId: `L${index.toString().padStart(idWidth, '0')}`,
        sectionTypeCode: 'M',
        speed: 0,
        speedUnit: 'provider-unspecified',
      }));
    expect(() => schema.parse({ ...snapshot, segments: createSegments(1_000, 4) })).not.toThrow();
    expect(() => schema.parse({ ...snapshot, segments: createSegments(1_001, 4) })).toThrow();
    expect(() =>
      schema.parse({ ...snapshot, segments: [{ ...snapshot.segments[0], linkId: 'L'.repeat(65) }] }),
    ).toThrow();
    expect(() => schema.parse({ ...snapshot, segments: createSegments(1_000, 62) })).toThrow();
  });
});
