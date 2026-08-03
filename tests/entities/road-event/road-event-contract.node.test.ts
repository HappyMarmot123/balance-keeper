// @vitest-environment node

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { RoadEvent, RoadEventGeometry, RoadEventSnapshot } from '../../../src/entities/road-event';
import * as roadEventModule from '../../../src/entities/road-event';

const roadEvent = roadEventModule as Readonly<Record<string, unknown>>;
const generatedAt = Date.parse('2026-08-03T12:00:00+09:00');

const pointEvent = {
  category: 'traffic-accident',
  endsAt: generatedAt + 60_000,
  geometry: {
    kind: 'point',
    position: [126.978, 37.5665],
  },
  id: 'incident-001',
  lifecycle: 'active',
  message: '차량 사고로 일부 차로가 통제 중입니다.',
  severity: 'provider-unspecified',
  startsAt: generatedAt - 60_000,
} as const;

const lineEvent = {
  category: 'roadwork',
  endsAt: null,
  geometry: {
    kind: 'line',
    path: [
      [126.978, 37.5665],
      [126.979, 37.567],
    ],
  },
  id: 'incident-002',
  lifecycle: 'unknown',
  message: null,
  severity: 'provider-unspecified',
  startsAt: generatedAt - 120_000,
} as const;

const incidentSnapshot = {
  channel: 'incidents',
  events: [pointEvent, lineEvent],
  generatedAt,
} as const;

const areaEvent = {
  category: 'flooding',
  endsAt: null,
  geometry: {
    kind: 'area',
    ring: [
      [126.97, 37.56],
      [126.98, 37.56],
      [126.98, 37.57],
      [126.97, 37.56],
    ],
  },
  id: 'disaster-001',
  lifecycle: 'unknown',
  message: '도로 침수 구간입니다.',
  severity: 'provider-unspecified',
  startsAt: generatedAt - 180_000,
} as const;

type RoadEventSchema = Readonly<{ parse(input: unknown): RoadEventSnapshot }>;

const getSchema = (): RoadEventSchema | undefined => roadEvent.roadEventDataSchema as RoadEventSchema | undefined;

describe('road event entity contract', () => {
  it('publishes readonly domain types and a strict provider-neutral snapshot', () => {
    expectTypeOf<RoadEventGeometry>().toMatchTypeOf<
      | Readonly<{ kind: 'point'; position: readonly [number, number] }>
      | Readonly<{ kind: 'line'; path: readonly (readonly [number, number])[] }>
      | Readonly<{ kind: 'area'; ring: readonly (readonly [number, number])[] }>
    >();
    expectTypeOf<RoadEvent>().toMatchTypeOf<
      Readonly<{
        id: string;
        geometry: RoadEventGeometry;
        message: string | null;
      }>
    >();

    const schema = getSchema();
    expect(schema).toBeDefined();
    expect(roadEvent.ROAD_EVENT_SEVERITY).toBe('provider-unspecified');
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(incidentSnapshot)).toEqual(incidentSnapshot);
    expect(() => schema.parse({ ...incidentSnapshot, provider: 'ITS' })).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [{ ...pointEvent, eventType: '교통사고' }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [{ ...pointEvent, providerId: 'raw-provider-id' }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [{ ...pointEvent, severity: 'high' }],
      }),
    ).toThrow();
  });

  it('accepts only the stable category set for each channel', () => {
    const schema = getSchema();
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    for (const category of ['roadwork', 'traffic-accident', 'weather', 'disaster', 'other']) {
      expect(() => schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, category }] })).not.toThrow();
    }
    for (const category of ['flooding', 'river-flood', 'sinkhole', 'wildfire']) {
      expect(() =>
        schema.parse({
          channel: 'disasters',
          events: [{ ...areaEvent, category }],
          generatedAt,
        }),
      ).not.toThrow();
    }

    expect(() => schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, category: 'flooding' }] })).toThrow();
    expect(() =>
      schema.parse({ channel: 'disasters', events: [{ ...areaEvent, category: 'roadwork' }], generatedAt }),
    ).toThrow();
    expect(() =>
      schema.parse({ channel: 'disasters', events: [{ ...areaEvent, message: null }], generatedAt }),
    ).toThrow();
    expect(() =>
      schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, category: 'provider-code' }] }),
    ).toThrow();
  });

  it('uses bounded discriminated point, line and unclosed-area geometry', () => {
    const schema = getSchema();
    expect(roadEvent.ROAD_EVENT_MAX_GEOMETRY_POSITIONS).toBe(2_000);
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() => schema.parse(incidentSnapshot)).not.toThrow();
    expect(() => schema.parse({ channel: 'disasters', events: [areaEvent], generatedAt })).not.toThrow();
    expect(() =>
      schema.parse({
        channel: 'disasters',
        events: [
          {
            ...areaEvent,
            geometry: {
              kind: 'area',
              ring: [
                [126.97, 37.56],
                [126.98, 37.56],
                [126.98, 37.57],
              ],
            },
          },
        ],
        generatedAt,
      }),
    ).not.toThrow();

    for (const position of [
      [123.999, 37],
      [132.001, 37],
      [127, 31.999],
      [127, 40.001],
      [Number.NaN, 37],
      [127, Number.POSITIVE_INFINITY],
      [127, 37, 0],
    ]) {
      expect(() =>
        schema.parse({
          ...incidentSnapshot,
          events: [{ ...pointEvent, geometry: { kind: 'point', position } }],
        }),
      ).toThrow();
    }

    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [{ ...pointEvent, geometry: { kind: 'line', path: [[127, 37]] } }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [
          {
            ...pointEvent,
            geometry: {
              kind: 'line',
              path: [
                [127, 37],
                [127, 37],
              ],
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [
          {
            ...pointEvent,
            geometry: {
              kind: 'area',
              ring: [
                [127, 37],
                [128, 37],
                [127, 37],
              ],
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [
          {
            ...pointEvent,
            geometry: {
              kind: 'area',
              ring: [
                [127, 37],
                [127, 37],
                [127, 37],
                [127, 37],
              ],
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [{ ...pointEvent, geometry: { kind: 'point', path: [[127, 37]], position: [127, 37] } }],
      }),
    ).toThrow();

    const oversizedPath = Array.from({ length: 2_001 }, (_, index) => [127, 37 + index / 100_000]);
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [{ ...pointEvent, geometry: { kind: 'line', path: oversizedPath } }],
      }),
    ).toThrow();
  });

  it('rejects already-ended events and requires lifecycle to match snapshot time', () => {
    const schema = getSchema();
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    const scheduled = {
      ...pointEvent,
      endsAt: null,
      lifecycle: 'scheduled',
      startsAt: generatedAt + 60_000,
    };
    expect(() => schema.parse({ ...incidentSnapshot, events: [scheduled] })).not.toThrow();

    expect(() => schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, endsAt: generatedAt }] })).toThrow();
    expect(() => schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, endsAt: generatedAt - 1 }] })).toThrow();
    expect(() =>
      schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, endsAt: null, lifecycle: 'active' }] }),
    ).toThrow();
    expect(() => schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, lifecycle: 'unknown' }] })).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [{ ...pointEvent, endsAt: generatedAt + 120_000, lifecycle: 'active', startsAt: generatedAt + 60_000 }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...incidentSnapshot,
        events: [{ ...pointEvent, endsAt: generatedAt + 30_000, startsAt: generatedAt + 60_000 }],
      }),
    ).toThrow();
  });

  it('requires unique ids and deterministic startsAt-descending then id-ascending order', () => {
    const schema = getSchema();
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() => schema.parse({ ...incidentSnapshot, events: [pointEvent, pointEvent] })).toThrow();
    expect(() => schema.parse({ ...incidentSnapshot, events: [...incidentSnapshot.events].reverse() })).toThrow();

    const sameTimeA = { ...lineEvent, id: 'event-a', startsAt: pointEvent.startsAt };
    const sameTimeB = { ...lineEvent, id: 'event-b', startsAt: pointEvent.startsAt };
    expect(() => schema.parse({ ...incidentSnapshot, events: [sameTimeA, sameTimeB] })).not.toThrow();
    expect(() => schema.parse({ ...incidentSnapshot, events: [sameTimeB, sameTimeA] })).toThrow();
  });

  it('bounds event fields, cardinality and normalized serialized bytes', () => {
    const schema = getSchema();
    expect(roadEvent.ROAD_EVENT_MAX_EVENTS).toBe(500);
    expect(roadEvent.ROAD_EVENT_MAX_ID_LENGTH).toBe(128);
    expect(roadEvent.ROAD_EVENT_MAX_MESSAGE_LENGTH).toBe(4_000);
    expect(roadEvent.ROAD_EVENT_MAX_SERIALIZED_BYTES).toBe(512 * 1024);
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() => schema.parse({ channel: 'incidents', events: [], generatedAt })).not.toThrow();
    for (const id of ['', ' ', ' event', 'event ', 'e'.repeat(129)]) {
      expect(() => schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, id }] })).toThrow();
    }
    expect(() =>
      schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, message: 'm'.repeat(4_000) }] }),
    ).not.toThrow();
    for (const message of ['', ' ', ' message', 'message ', 'm'.repeat(4_001)]) {
      expect(() => schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, message }] })).toThrow();
    }
    for (const timestamp of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 8_640_000_000_000_001]) {
      expect(() => schema.parse({ ...incidentSnapshot, generatedAt: timestamp })).toThrow();
      expect(() => schema.parse({ ...incidentSnapshot, events: [{ ...pointEvent, startsAt: timestamp }] })).toThrow();
    }

    const createEvents = (length: number, message: string | null = null) =>
      Array.from({ length }, (_, index) => ({
        ...lineEvent,
        id: `event-${index.toString().padStart(4, '0')}`,
        message,
      }));
    expect(() => schema.parse({ ...incidentSnapshot, events: createEvents(500) })).not.toThrow();
    expect(() => schema.parse({ ...incidentSnapshot, events: createEvents(501) })).toThrow();
    expect(() => schema.parse({ ...incidentSnapshot, events: createEvents(150, 'm'.repeat(4_000)) })).toThrow();
  });
});
