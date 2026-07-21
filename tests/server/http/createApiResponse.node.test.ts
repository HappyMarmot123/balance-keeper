// @vitest-environment node

import { describe, expect, expectTypeOf, it } from 'vitest';

import { type CreateApiResponseOptions, createApiResponse, type JsonValue } from '../../../src/server/http';

describe('createApiResponse', () => {
  it('accepts only JSON values at its public body boundary', () => {
    expectTypeOf<CreateApiResponseOptions['body']>().toEqualTypeOf<JsonValue>();
  });

  it('returns cacheable JSON or a bodyless 304 for a matching current representation', async () => {
    const body = { data: { value: 1 }, meta: { requestId: 'origin-1' } };
    const etag = 'W/"bk1-current"';

    const current = createApiResponse({
      body,
      cache: 'current',
      etag,
      ifNoneMatch: null,
      requestId: 'origin-1',
      status: 200,
    });

    expect(current.status).toBe(200);
    expect(await current.json()).toEqual(body);
    expect(current.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(current.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(current.headers.get('etag')).toBe(etag);
    expect(current.headers.get('x-request-id')).toBe('origin-1');

    const revalidated = createApiResponse({
      body,
      cache: 'current',
      etag,
      ifNoneMatch: '"bk1-current"',
      requestId: 'revalidation-2',
      status: 200,
    });

    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe('');
    expect(revalidated.headers.get('content-type')).toBeNull();
    expect(revalidated.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(revalidated.headers.get('etag')).toBe(etag);
    expect(revalidated.headers.get('x-request-id')).toBe('revalidation-2');
  });

  it('keeps stale and failure responses bodyful and non-cacheable', async () => {
    const stale = createApiResponse({
      body: { data: ['last-good'] },
      cache: 'no-store',
      etag: 'W/"bk1-stale"',
      requestId: 'stale-1',
      status: 200,
    });

    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ data: ['last-good'] });
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect(stale.headers.get('etag')).toBe('W/"bk1-stale"');

    const limited = createApiResponse({
      body: { error: { code: 'RATE_LIMITED', requestId: 'rate-1' } },
      cache: 'no-store',
      requestId: 'rate-1',
      retryAfterSeconds: 12,
      status: 429,
    });

    expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(limited.headers.get('retry-after')).toBe('12');
  });

  it('rejects invalid Retry-After values before constructing a response', () => {
    const createLimitedResponse = (retryAfterSeconds: number) =>
      createApiResponse({
        body: { error: { code: 'RATE_LIMITED', requestId: 'rate-invalid' } },
        cache: 'no-store',
        requestId: 'rate-invalid',
        retryAfterSeconds,
        status: 429,
      });

    expect(() => createLimitedResponse(0)).toThrow(TypeError);
    expect(() => createLimitedResponse(1.5)).toThrow(TypeError);
    expect(() => createLimitedResponse(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });

  it('rejects values that cannot produce a JSON response body', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const createResponseWithBody = (body: unknown) =>
      createApiResponse({
        body: body as JsonValue,
        cache: 'no-store',
        requestId: 'invalid-json',
        status: 200,
      });

    expect(() => createResponseWithBody(undefined)).toThrow(TypeError);
    expect(() => createResponseWithBody(1n)).toThrow(TypeError);
    expect(() => createResponseWithBody(cyclic)).toThrow(TypeError);
  });

  it.each([199, 200.5, 204, 304, 600])('rejects unsupported body response status %s', (status) => {
    expect(() =>
      createApiResponse({
        body: { error: { code: 'INTERNAL', requestId: 'invalid-status' } },
        cache: 'no-store',
        requestId: 'invalid-status',
        status: status as never,
      }),
    ).toThrow(TypeError);
  });
});
