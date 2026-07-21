// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyCacheRecord, createCacheRecordSchema } from '../../../src/server/cache';

describe('cache record public boundary', () => {
  it('exports the schema factory and classifier', async () => {
    const cacheModule = await import('../../../src/server/cache');

    expect(cacheModule).toMatchObject({
      createCacheRecordSchema: expect.any(Function),
      classifyCacheRecord: expect.any(Function),
    });
  });
});

const dataSchema = z.strictObject({ value: z.number() });
const getRecordSchema = () => createCacheRecordSchema(dataSchema);

const positiveRecord = {
  version: 1 as const,
  kind: 'positive' as const,
  data: { value: 7 },
  source: 'fixture-source',
  fetchedAt: 900,
  storedAt: 1_000,
  freshUntil: 1_100,
  staleUntil: 1_300,
};

const negativeRecord = {
  version: 1 as const,
  kind: 'negative' as const,
  data: { value: 0 },
  source: 'fixture-source',
  fetchedAt: 900,
  storedAt: 1_000,
  freshUntil: 1_100,
};

describe('createCacheRecordSchema', () => {
  it('accepts strict version 1 positive and negative records', () => {
    const recordSchema = getRecordSchema();
    expect(recordSchema.parse(positiveRecord)).toEqual(positiveRecord);
    expect(recordSchema.parse(negativeRecord)).toEqual(negativeRecord);
  });

  it('does not allow a stale interval on a negative record', () => {
    expect(getRecordSchema().safeParse({ ...negativeRecord, staleUntil: 1_300 }).success).toBe(false);
  });

  it('requires the stale boundary on a positive record', () => {
    const { staleUntil: _staleUntil, ...missingStale } = positiveRecord;
    expect(getRecordSchema().safeParse(missingStale).success).toBe(false);
  });

  it.each([
    ['version mismatch', { ...positiveRecord, version: 2 }],
    ['unknown field', { ...positiveRecord, privateMetadata: 'do-not-store' }],
    ['negative epoch', { ...positiveRecord, fetchedAt: -1 }],
    ['fractional epoch', { ...positiveRecord, storedAt: 1.5 }],
    ['unsafe epoch', { ...positiveRecord, staleUntil: Number.MAX_SAFE_INTEGER + 1 }],
    ['domain schema mismatch', { ...positiveRecord, data: { value: '7' } }],
  ])('rejects %s', (_label, input) => {
    expect(getRecordSchema().safeParse(input).success).toBe(false);
  });

  it.each([
    ['fresh before stored', { ...positiveRecord, freshUntil: 999 }],
    ['stale before fresh', { ...positiveRecord, staleUntil: 1_099 }],
    ['negative fresh before stored', { ...negativeRecord, freshUntil: 999 }],
  ])('rejects an impossible timeline: %s', (_label, input) => {
    expect(getRecordSchema().safeParse(input).success).toBe(false);
  });
});

describe('classifyCacheRecord', () => {
  it('classifies a positive record as fresh immediately before freshUntil', () => {
    expect(classifyCacheRecord(getRecordSchema(), positiveRecord, 1_099)).toEqual({
      state: 'fresh',
      record: positiveRecord,
    });
  });

  it('classifies a positive record as stale at freshUntil and before staleUntil', () => {
    expect(classifyCacheRecord(getRecordSchema(), positiveRecord, 1_100)).toEqual({
      state: 'stale',
      record: positiveRecord,
    });
    expect(classifyCacheRecord(getRecordSchema(), positiveRecord, 1_299)).toEqual({
      state: 'stale',
      record: positiveRecord,
    });
  });

  it('classifies a positive record as expired exactly at staleUntil', () => {
    expect(classifyCacheRecord(getRecordSchema(), positiveRecord, 1_300)).toEqual({
      state: 'expired',
      record: positiveRecord,
    });
  });

  it('classifies a negative record as fresh before freshUntil and expired at freshUntil', () => {
    expect(classifyCacheRecord(getRecordSchema(), negativeRecord, 1_099)).toEqual({
      state: 'fresh',
      record: negativeRecord,
    });
    expect(classifyCacheRecord(getRecordSchema(), negativeRecord, 1_100)).toEqual({
      state: 'expired',
      record: negativeRecord,
    });
  });

  it('classifies malformed and version-mismatched input as invalid without exposing it', () => {
    expect(classifyCacheRecord(getRecordSchema(), { ...positiveRecord, version: 2 }, 1_050)).toEqual({
      state: 'invalid',
    });
    expect(classifyCacheRecord(getRecordSchema(), 'corrupt-record', 1_050)).toEqual({ state: 'invalid' });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])('rejects invalid current time %s', (now) => {
    expect(() => classifyCacheRecord(getRecordSchema(), positiveRecord, now)).toThrow(RangeError);
  });
});
