// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  type ApiErrorCode,
  apiErrorCodeSchema,
  apiErrorStatusSchema,
  type ErrorEnvelope,
  errorEnvelopeSchema,
  successEnvelopeSchema,
} from '../../../src/shared/contracts';
import {
  clientApiErrorCodes,
  malformedErrorEnvelopeFixtures,
  malformedSuccessEnvelopeFixtures,
  serverApiErrorCodes,
  successEnvelopeBoundaryFixtures,
  validErrorEnvelopeFixture,
  validSuccessEnvelopeFixture,
} from '../../fixtures/transport/envelopes';

const signalDataSchema = z.object({ signalCount: z.number().int().nonnegative() }).strict();
const signalEnvelopeSchema = successEnvelopeSchema(signalDataSchema);

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type ApiErrorCodeComesFromSchema = Expect<Equal<ApiErrorCode, z.infer<typeof apiErrorCodeSchema>>>;
type ErrorEnvelopeComesFromSchema = Expect<Equal<ErrorEnvelope, z.infer<typeof errorEnvelopeSchema>>>;

const apiErrorCodeTypeProof: ApiErrorCodeComesFromSchema = true;
const errorEnvelopeTypeProof: ErrorEnvelopeComesFromSchema = true;

describe('transport envelope contracts', () => {
  it('parses the success fixture with its supplied data schema', () => {
    expect(signalEnvelopeSchema.parse(validSuccessEnvelopeFixture)).toEqual(validSuccessEnvelopeFixture);
  });

  it.each(['MISS', 'HIT', 'STALE', 'REVALIDATED'] as const)('accepts the %s cache state', (cache) => {
    const fixture = {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, cache },
    };

    expect(signalEnvelopeSchema.parse(fixture).meta.cache).toBe(cache);
  });

  it.each(successEnvelopeBoundaryFixtures)('accepts $name', ({ value }) => {
    expect(signalEnvelopeSchema.safeParse(value).success).toBe(true);
  });

  it.each(malformedSuccessEnvelopeFixtures)('rejects $name', ({ value }) => {
    expect(signalEnvelopeSchema.safeParse(value).success).toBe(false);
  });

  it('rejects data that violates the supplied schema', () => {
    const fixture = {
      ...validSuccessEnvelopeFixture,
      data: { signalCount: '3' },
    };

    expect(signalEnvelopeSchema.safeParse(fixture).success).toBe(false);
  });

  it('parses the strict server error fixture', () => {
    expect(errorEnvelopeSchema.parse(validErrorEnvelopeFixture)).toEqual(validErrorEnvelopeFixture);
  });

  it('accepts a server error without field details', () => {
    const fixture = { error: { code: 'NOT_FOUND', requestId: 'req-not-found' } };

    expect(errorEnvelopeSchema.parse(fixture)).toEqual(fixture);
  });

  it('accepts multiple reproducible field details', () => {
    const fixture = {
      error: {
        code: 'BAD_REQUEST',
        fields: {
          bbox: ['must contain four finite coordinates'],
          region: ['must be a supported region', 'must not contain whitespace'],
        },
        requestId: 'req-many-fields',
      },
    };

    expect(errorEnvelopeSchema.parse(fixture)).toEqual(fixture);
  });

  it.each(malformedErrorEnvelopeFixtures)('rejects $name', ({ value }) => {
    expect(errorEnvelopeSchema.safeParse(value).success).toBe(false);
  });

  it.each([...serverApiErrorCodes, ...clientApiErrorCodes])('accepts the %s application error code', (code) => {
    expect(apiErrorCodeSchema.parse(code)).toBe(code);
  });

  it('rejects unregistered application error codes', () => {
    expect(apiErrorCodeSchema.safeParse('UNKNOWN_ERROR').success).toBe(false);
  });

  it.each([0, 100, 599])('accepts boundary application status %i', (status) => {
    expect(apiErrorStatusSchema.parse(status)).toBe(status);
  });

  it.each([-1, 1, 99, 600, 1.5])('rejects non-HTTP application status %s', (status) => {
    expect(apiErrorStatusSchema.safeParse(status).success).toBe(false);
  });

  it('keeps the exported contract types derived from their schemas', () => {
    expect(apiErrorCodeTypeProof).toBe(true);
    expect(errorEnvelopeTypeProof).toBe(true);

    type SignalEnvelope = z.infer<typeof signalEnvelopeSchema>;
    const valid: SignalEnvelope = validSuccessEnvelopeFixture;

    // @ts-expect-error the data output is inferred from signalDataSchema
    const invalid: SignalEnvelope = { ...validSuccessEnvelopeFixture, data: { signalCount: '3' } };

    expect(valid.data.signalCount).toBe(3);
    expect(invalid.data.signalCount).toBe('3');
  });
});
