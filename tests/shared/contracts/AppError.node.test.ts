// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { type ApiErrorCode, AppError, isAppError, statusForApiErrorCode } from '../../../src/shared/contracts';

const statusCases = [
  ['BAD_REQUEST', 400],
  ['UNAUTHORIZED', 401],
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['UNPROCESSABLE_CONTENT', 422],
  ['RATE_LIMITED', 429],
  ['INTERNAL', 500],
  ['UPSTREAM_UNAVAILABLE', 502],
  ['MISSING_CREDENTIALS', 503],
  ['SERVICE_UNAVAILABLE', 503],
  ['NETWORK_ERROR', 0],
  ['INVALID_RESPONSE', 0],
] as const satisfies ReadonlyArray<readonly [ApiErrorCode, number]>;

describe('AppError', () => {
  it.each(statusCases)('maps %s to status %i', (code, status) => {
    expect(statusForApiErrorCode(code)).toBe(status);
    expect(new AppError(code).status).toBe(status);
  });

  it('preserves status, fields, request id, and cause', () => {
    const cause = new Error('transport failed');
    const fields = { bbox: ['must contain four finite coordinates'] };
    const error = new AppError('INVALID_RESPONSE', {
      cause,
      fields,
      requestId: 'req-client-1',
      status: 502,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.message).toBe('INVALID_RESPONSE');
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.status).toBe(502);
    expect(error.fields).toBe(fields);
    expect(error.requestId).toBe('req-client-1');
    expect(error.cause).toBe(cause);
  });

  it.each([-1, 1.5, 600, Number.NaN])('rejects invalid status %s', (status) => {
    expect(() => new AppError('INVALID_RESPONSE', { status })).toThrow();
  });

  it.each([
    ['BAD_REQUEST', 503],
    ['UPSTREAM_UNAVAILABLE', 503],
    ['NETWORK_ERROR', 200],
    ['INVALID_RESPONSE', 1],
    ['INVALID_RESPONSE', 99],
  ] as const)('rejects the invalid %s/%i code-status pair', (code, status) => {
    expect(() => new AppError(code, { status })).toThrow();
  });

  it.each([0, 100, 200, 599])('accepts INVALID_RESPONSE with boundary status %i', (status) => {
    expect(new AppError('INVALID_RESPONSE', { status }).status).toBe(status);
  });

  it('identifies only actual AppError instances', () => {
    expect(isAppError(new AppError('BAD_REQUEST'))).toBe(true);
    expect(isAppError({ code: 'BAD_REQUEST', status: 400 })).toBe(false);
    expect(isAppError(new Error('BAD_REQUEST'))).toBe(false);
  });
});
