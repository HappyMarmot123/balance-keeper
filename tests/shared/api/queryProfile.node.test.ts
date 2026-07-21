import { describe, expect, it } from 'vitest';

import { queryClient } from '../../../src/shared/api/queryClient';
import { createQueryProfile, shouldRetryQuery } from '../../../src/shared/api/queryProfile';
import { AppError } from '../../../src/shared/contracts';

describe('createQueryProfile', () => {
  it('preserves the provided timings and applies shared query behavior', () => {
    const profile = createQueryProfile({
      staleTime: 12_345,
      refetchInterval: 67_890,
    });

    expect(profile).toEqual({
      staleTime: 12_345,
      refetchInterval: 67_890,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchIntervalInBackground: false,
      retry: shouldRetryQuery,
    });
  });

  it('lets an owning entity disable interval polling', () => {
    const profile = createQueryProfile({
      staleTime: 12_345,
      refetchInterval: false,
    });

    expect(profile.refetchInterval).toBe(false);
  });
});

describe('shouldRetryQuery', () => {
  it.each([
    ['network errors', new AppError('NETWORK_ERROR')],
    ['502 server errors', new AppError('UPSTREAM_UNAVAILABLE')],
    ['503 server errors', new AppError('SERVICE_UNAVAILABLE')],
  ])('retries %s at most twice', (_label, error) => {
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });

  it('does not retry aborted requests', () => {
    expect(shouldRetryQuery(0, new DOMException('cancelled', 'AbortError'))).toBe(false);
  });

  it.each([
    ['BAD_REQUEST', new AppError('BAD_REQUEST')],
    ['UNAUTHORIZED', new AppError('UNAUTHORIZED')],
    ['FORBIDDEN', new AppError('FORBIDDEN')],
    ['NOT_FOUND', new AppError('NOT_FOUND')],
    ['UNPROCESSABLE_CONTENT', new AppError('UNPROCESSABLE_CONTENT')],
    ['RATE_LIMITED', new AppError('RATE_LIMITED')],
    ['INTERNAL', new AppError('INTERNAL')],
  ])('does not retry %s', (_code, error) => {
    expect(shouldRetryQuery(0, error)).toBe(false);
  });

  it.each([
    ['INVALID_RESPONSE', new AppError('INVALID_RESPONSE', { status: 502 })],
    ['MISSING_CREDENTIALS', new AppError('MISSING_CREDENTIALS')],
  ])('does not retry %s errors', (_code, error) => {
    expect(shouldRetryQuery(0, error)).toBe(false);
  });

  it.each([
    new Error('unknown'),
    { code: 'NETWORK_ERROR' },
    { code: 'UPSTREAM_UNAVAILABLE', status: 502 },
    { code: 'UNKNOWN_ERROR', status: 502 },
    { code: 'UNKNOWN_ERROR', status: 504 },
    'NETWORK_ERROR',
    null,
  ])('does not retry unknown failures', (error) => {
    expect(shouldRetryQuery(0, error)).toBe(false);
  });
});

describe('queryClient defaults', () => {
  it('shares retry behavior without a global freshness or polling policy', () => {
    const defaults = queryClient.getDefaultOptions().queries;

    expect(defaults?.retry).toBe(shouldRetryQuery);
    expect(defaults?.refetchOnWindowFocus).toBe(true);
    expect(defaults?.refetchOnReconnect).toBe(true);
    expect(defaults).not.toHaveProperty('staleTime');
    expect(defaults).not.toHaveProperty('refetchInterval');
  });
});
