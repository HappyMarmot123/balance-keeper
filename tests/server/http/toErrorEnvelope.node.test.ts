// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { toErrorEnvelope } from '../../../src/server/http';
import { AppError, errorEnvelopeSchema } from '../../../src/shared/contracts';

describe('toErrorEnvelope', () => {
  it('serializes a server AppError with only safe contract fields', () => {
    const error = new AppError('BAD_REQUEST', {
      fields: { bbox: ['must contain four finite coordinates'] },
      requestId: 'req-original',
    });
    error.message = 'provider key leaked in message';
    Object.assign(error, {
      raw: { provider: 'secret upstream body' },
      token: 'secret-token',
    });

    const serialized = toErrorEnvelope(error, 'req-current');

    expect(serialized).toEqual({
      envelope: {
        error: {
          code: 'BAD_REQUEST',
          fields: { bbox: ['must contain four finite coordinates'] },
          requestId: 'req-current',
        },
      },
      status: 400,
    });
    expect(errorEnvelopeSchema.safeParse(serialized.envelope).success).toBe(true);
  });

  it('omits fields when a server AppError has no field details', () => {
    expect(toErrorEnvelope(new AppError('NOT_FOUND'), 'req-not-found')).toEqual({
      envelope: { error: { code: 'NOT_FOUND', requestId: 'req-not-found' } },
      status: 404,
    });
  });

  it('uses the canonical server status instead of a caller override', () => {
    const error = new AppError('BAD_REQUEST');
    Object.defineProperty(error, 'status', { value: 599 });

    expect(toErrorEnvelope(error, 'req-canonical-status')).toEqual({
      envelope: { error: { code: 'BAD_REQUEST', requestId: 'req-canonical-status' } },
      status: 400,
    });
  });

  it('redacts a malformed known AppError instead of throwing from the serializer', () => {
    const error = new AppError('BAD_REQUEST');
    Object.defineProperty(error, 'fields', { value: { bbox: 'raw provider detail' } });

    expect(toErrorEnvelope(error, 'req-malformed-fields')).toEqual({
      envelope: { error: { code: 'INTERNAL', requestId: 'req-malformed-fields' } },
      status: 500,
    });
  });

  it('maps unknown failures to a redacted INTERNAL 500 response', () => {
    const unknown = Object.assign(new Error('database password is hunter2'), {
      cause: new Error('raw provider body'),
      raw: '<html>secret</html>',
      requestId: 'untrusted-request-id',
      status: 418,
    });

    const serialized = toErrorEnvelope(unknown, 'req-internal');
    const json = JSON.stringify(serialized.envelope);

    expect(serialized).toEqual({
      envelope: { error: { code: 'INTERNAL', requestId: 'req-internal' } },
      status: 500,
    });
    expect(json).not.toContain('password');
    expect(json).not.toContain('provider');
    expect(json).not.toContain('raw');
    expect(json).not.toContain('status');
    expect(json).not.toContain('cause');
    expect(json).not.toContain('untrusted-request-id');
  });

  it.each(['NETWORK_ERROR', 'INVALID_RESPONSE'] as const)(
    'does not serialize the client-only %s code from a server boundary',
    (code) => {
      expect(toErrorEnvelope(new AppError(code), 'req-server')).toEqual({
        envelope: { error: { code: 'INTERNAL', requestId: 'req-server' } },
        status: 500,
      });
    },
  );

  it('rejects an invalid serializer request id', () => {
    expect(() => toErrorEnvelope(new AppError('INTERNAL'), '')).toThrow();
  });
});
