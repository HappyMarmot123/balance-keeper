// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import * as macroModule from '../../../src/entities/macro';

const macro = macroModule as Record<string, unknown>;

const snapshotFixture = {
  series: [
    {
      cycle: 'D',
      displayUnit: '원',
      id: 'usd-krw',
      itemCode: '0000001',
      label: '원/미국달러',
      observation: {
        period: '20260728',
        sourceValue: 1_382.4,
        value: 1_382.4,
      },
      sourceUnit: '원',
      statCode: '731Y001',
      status: 'available',
    },
    {
      cycle: 'D',
      displayUnit: '%',
      id: 'base-rate',
      itemCode: '0101000',
      label: '한국은행 기준금리',
      observation: {
        period: '20260728',
        sourceValue: 2.5,
        value: 2.5,
      },
      sourceUnit: '연%',
      statCode: '722Y001',
      status: 'available',
    },
    {
      cycle: 'M',
      displayUnit: '억 달러',
      id: 'fx-reserves',
      itemCode: '99',
      label: '외환보유액',
      observation: {
        period: '202606',
        sourceValue: 418_300_000,
        value: 4_183,
      },
      sourceUnit: '천달러',
      statCode: '732Y001',
      status: 'available',
    },
  ],
} as const;

describe('macro public contract', () => {
  it('owns the three officially discovered ECOS series in canonical order', () => {
    expect(macro.MACRO_SERIES).toEqual([
      {
        cycle: 'D',
        displayUnit: '원',
        id: 'usd-krw',
        itemCode: '0000001',
        label: '원/미국달러',
        sourceUnit: '원',
        statCode: '731Y001',
      },
      {
        cycle: 'D',
        displayUnit: '%',
        id: 'base-rate',
        itemCode: '0101000',
        label: '한국은행 기준금리',
        sourceUnit: '연%',
        statCode: '722Y001',
      },
      {
        cycle: 'M',
        displayUnit: '억 달러',
        id: 'fx-reserves',
        itemCode: '99',
        label: '외환보유액',
        sourceUnit: '천달러',
        statCode: '732Y001',
      },
    ]);
  });

  it('accepts a strict snapshot and rejects reordered or inconsistent series', () => {
    const schema = macro.macroDataSchema as
      | { parse: (input: unknown) => unknown; safeParse: (input: unknown) => { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(snapshotFixture)).toEqual(snapshotFixture);
    expect(
      schema.safeParse({
        series: [snapshotFixture.series[1], snapshotFixture.series[0], snapshotFixture.series[2]],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        series: [
          { ...snapshotFixture.series[0], observation: null, status: 'available' },
          snapshotFixture.series[1],
          snapshotFixture.series[2],
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        series: [
          snapshotFixture.series[0],
          snapshotFixture.series[1],
          {
            ...snapshotFixture.series[2],
            observation: { ...snapshotFixture.series[2].observation, period: '202613' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('permits explicit empty and unavailable series without inventing a value', () => {
    const schema = macro.macroDataSchema as { parse: (input: unknown) => unknown } | undefined;

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(
      schema.parse({
        series: [
          { ...snapshotFixture.series[0], observation: null, status: 'empty' },
          snapshotFixture.series[1],
          { ...snapshotFixture.series[2], observation: null, status: 'unavailable' },
        ],
      }),
    ).toBeDefined();
  });
});

describe('macro query options', () => {
  it('uses one fixed gateway path and a cadence suitable for daily/monthly observations', async () => {
    const queryOptions = macro.macroQueryOptions as
      | ((dependencies?: { fetcher?: typeof fetch }) => {
          queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
          queryKey: readonly unknown[];
        })
      | undefined;
    const profile = macro.MACRO_QUERY_PROFILE as Record<string, unknown> | undefined;

    expect(queryOptions).toBeTypeOf('function');
    expect(profile).toMatchObject({
      refetchInterval: 6 * 60 * 60_000,
      refetchIntervalInBackground: false,
      staleTime: 3 * 60 * 60_000,
    });
    if (queryOptions === undefined) {
      return;
    }

    const envelope = {
      data: snapshotFixture,
      meta: {
        cache: 'MISS',
        fetchedAt: Date.parse('2026-07-28T03:00:00Z'),
        requestId: 'macro-query',
        source: 'ECOS',
      },
    };
    const fetcher = vi.fn(async () =>
      Response.json(envelope, {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const options = queryOptions({ fetcher });
    const signal = new AbortController().signal;

    expect(options.queryKey).toEqual(['macro']);
    await expect(options.queryFn({ signal })).resolves.toEqual(envelope);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/macro',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal }),
    );
  });
});
