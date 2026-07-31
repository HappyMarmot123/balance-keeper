// @vitest-environment node

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { MaritimeTrafficSnapshot } from '../../../src/entities/maritime-traffic';
import * as maritimeTrafficModule from '../../../src/entities/maritime-traffic';

const maritimeTraffic = maritimeTrafficModule as Record<string, unknown>;

const snapshot = {
  cells: [
    {
      densityPercent: 12.5,
      gridId: 'GRID-001',
      vesselCount: 3,
    },
    {
      densityPercent: 50,
      gridId: 'GRID-002',
      vesselCount: 10,
    },
  ],
  generatedAt: Date.parse('2026-07-31T06:30:00.000Z'),
} as const;

describe('maritime traffic entity contract', () => {
  it('exposes a readonly public snapshot type', () => {
    expectTypeOf<MaritimeTrafficSnapshot>().toEqualTypeOf<
      Readonly<{
        cells: readonly Readonly<{
          densityPercent: number;
          gridId: string;
          vesselCount: number;
        }>[];
        generatedAt: number;
      }>
    >();
  });

  it('exposes and parses a strict non-identifying grid snapshot', () => {
    const schema = maritimeTraffic.maritimeTrafficDataSchema as { parse(input: unknown): typeof snapshot } | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(snapshot)).toEqual(snapshot);
    expect(() => schema.parse({ ...snapshot, vesselMmsi: '440123456' })).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        cells: [{ ...snapshot.cells[0], vesselName: 'individual vessel is forbidden' }],
      }),
    ).toThrow();
  });

  it('accepts only finite epoch milliseconds and bounded aggregate numbers', () => {
    const schema = maritimeTraffic.maritimeTrafficDataSchema as { parse(input: unknown): typeof snapshot } | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() =>
      schema.parse({
        cells: [{ densityPercent: 0, gridId: 'GRID-000', vesselCount: 0 }],
        generatedAt: 0,
      }),
    ).not.toThrow();
    expect(() =>
      schema.parse({
        cells: [{ densityPercent: 100, gridId: 'GRID-999', vesselCount: Number.MAX_SAFE_INTEGER }],
        generatedAt: 8_640_000_000_000_000,
      }),
    ).not.toThrow();

    for (const generatedAt of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 8_640_000_000_000_001]) {
      expect(() => schema.parse({ ...snapshot, generatedAt })).toThrow();
    }

    for (const vesselCount of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        schema.parse({
          ...snapshot,
          cells: [{ ...snapshot.cells[0], vesselCount }],
        }),
      ).toThrow();
    }

    for (const densityPercent of [-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        schema.parse({
          ...snapshot,
          cells: [{ ...snapshot.cells[0], densityPercent }],
        }),
      ).toThrow();
    }
  });

  it('requires non-blank, unique grid ids in deterministic ascending order', () => {
    const schema = maritimeTraffic.maritimeTrafficDataSchema as { parse(input: unknown): typeof snapshot } | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    for (const gridId of ['', '   ', ' GRID-001', 'GRID-001 ']) {
      expect(() =>
        schema.parse({
          ...snapshot,
          cells: [{ ...snapshot.cells[0], gridId }],
        }),
      ).toThrow();
    }

    expect(() =>
      schema.parse({
        ...snapshot,
        cells: [snapshot.cells[0], snapshot.cells[0]],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        cells: [...snapshot.cells].reverse(),
      }),
    ).toThrow();
  });

  it('bounds one snapshot to 5,000 sorted cells while allowing an atomic empty result', () => {
    const schema = maritimeTraffic.maritimeTrafficDataSchema as { parse(input: unknown): typeof snapshot } | undefined;

    expect(maritimeTraffic.MARITIME_TRAFFIC_MAX_CELLS).toBe(5_000);
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() => schema.parse({ cells: [], generatedAt: snapshot.generatedAt })).not.toThrow();

    const cells = Array.from({ length: 5_001 }, (_, index) => ({
      densityPercent: 0,
      gridId: `GRID-${index.toString().padStart(4, '0')}`,
      vesselCount: 0,
    }));
    expect(() => schema.parse({ cells: cells.slice(0, 5_000), generatedAt: snapshot.generatedAt })).not.toThrow();
    expect(() => schema.parse({ cells, generatedAt: snapshot.generatedAt })).toThrow();
  });

  it('bounds canonical grid identifiers and the normalized snapshot representation', () => {
    const schema = maritimeTraffic.maritimeTrafficDataSchema as { parse(input: unknown): typeof snapshot } | undefined;

    expect(maritimeTraffic.MARITIME_TRAFFIC_MAX_GRID_ID_LENGTH).toBe(128);
    expect(maritimeTraffic.MARITIME_TRAFFIC_MAX_SERIALIZED_BYTES).toBe(2 * 1024 * 1024);
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() =>
      schema.parse({
        cells: [{ densityPercent: 0, gridId: 'G'.repeat(128), vesselCount: 0 }],
        generatedAt: snapshot.generatedAt,
      }),
    ).not.toThrow();
    expect(() =>
      schema.parse({
        cells: [{ densityPercent: 0, gridId: 'G'.repeat(129), vesselCount: 0 }],
        generatedAt: snapshot.generatedAt,
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        cells: [{ densityPercent: 0, gridId: 'G'.repeat(5 * 1024 * 1024), vesselCount: 0 }],
        generatedAt: snapshot.generatedAt,
      }),
    ).toThrow();
  });
});
