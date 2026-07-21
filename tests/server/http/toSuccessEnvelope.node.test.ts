// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toSuccessEnvelope } from '../../../src/server/http';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const signalDataSchema = z
  .object({
    signalCount: z.coerce.number().int().nonnegative(),
  })
  .strict();

const validMeta = {
  cache: 'MISS',
  fetchedAt: 1_721_520_000_000,
  requestId: 'req-success-1',
  source: 'fixture-source',
} as const;

describe('toSuccessEnvelope', () => {
  it('parses input and returns the schema-derived output envelope', () => {
    const envelope = toSuccessEnvelope(signalDataSchema, { signalCount: '3' }, validMeta);
    const signalCount: number = envelope.data.signalCount;

    expect(envelope).toEqual({ data: { signalCount: 3 }, meta: validMeta });
    expect(signalCount).toBe(3);
    expect(successEnvelopeSchema(signalDataSchema).safeParse(envelope).success).toBe(true);
  });

  it('rejects data outside the owning domain schema', () => {
    expect(() => toSuccessEnvelope(signalDataSchema, { signalCount: 'not-a-number' }, validMeta)).toThrow();
  });

  it('rejects metadata outside the strict transport contract', () => {
    const metaWithExtraField = { ...validMeta, ttl: 60 };

    expect(() => toSuccessEnvelope(signalDataSchema, { signalCount: '3' }, metaWithExtraField)).toThrow();
  });
});
