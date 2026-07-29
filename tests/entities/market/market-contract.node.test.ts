// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as marketModule from '../../../src/entities/market';

const market = marketModule as Record<string, unknown>;

const snapshotFixture = {
  indices: [
    {
      displayUnit: 'pt',
      id: 'kospi',
      label: 'KOSPI',
      observation: {
        change: 18.42,
        changePercent: 0.66,
        close: 2_811.72,
        date: '20260727',
      },
      providerName: '코스피',
      status: 'available',
    },
    {
      displayUnit: 'pt',
      id: 'kosdaq',
      label: 'KOSDAQ',
      observation: {
        change: -3.15,
        changePercent: -0.39,
        close: 807.41,
        date: '20260727',
      },
      providerName: '코스닥',
      status: 'available',
    },
  ],
} as const;

describe('market public contract', () => {
  it('owns the two approved domestic indices in canonical order', () => {
    expect(market.MARKET_INDEXES).toEqual([
      {
        displayUnit: 'pt',
        id: 'kospi',
        label: 'KOSPI',
        providerName: '코스피',
      },
      {
        displayUnit: 'pt',
        id: 'kosdaq',
        label: 'KOSDAQ',
        providerName: '코스닥',
      },
    ]);
  });

  it('accepts a strict snapshot and rejects invented, reordered or invalid observations', () => {
    const schema = market.marketDataSchema as
      | { parse: (input: unknown) => unknown; safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(snapshotFixture)).toEqual(snapshotFixture);
    expect(schema.safeParse({ indices: [snapshotFixture.indices[1], snapshotFixture.indices[0]] }).success).toBe(false);
    expect(
      schema.safeParse({
        indices: [
          { ...snapshotFixture.indices[0], observation: null, status: 'available' },
          snapshotFixture.indices[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        indices: [
          {
            ...snapshotFixture.indices[0],
            observation: { ...snapshotFixture.indices[0].observation, date: '20260230' },
          },
          snapshotFixture.indices[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        indices: [
          {
            ...snapshotFixture.indices[0],
            observation: { ...snapshotFixture.indices[0].observation, close: 0 },
          },
          snapshotFixture.indices[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        indices: [
          {
            ...snapshotFixture.indices[0],
            observation: {
              ...snapshotFixture.indices[0].observation,
              change: 18.42,
              changePercent: -0.66,
            },
          },
          snapshotFixture.indices[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        indices: snapshotFixture.indices.map((index) => ({
          ...index,
          observation: null,
          status: 'unavailable',
        })),
      }).success,
    ).toBe(false);
  });

  it('permits explicit empty and partial-unavailable results without fabricating a close', () => {
    const schema = market.marketDataSchema as { parse: (input: unknown) => unknown } | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(
      schema.parse({
        indices: [
          { ...snapshotFixture.indices[0], observation: null, status: 'empty' },
          { ...snapshotFixture.indices[1], observation: null, status: 'unavailable' },
        ],
      }),
    ).toBeDefined();
  });
});
