// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { fetchJson, type JsonFetcher } from '../../../src/shared/api/fetchJson';
import { type AppError, isAppError } from '../../../src/shared/contracts';
import { validSuccessEnvelopeFixture } from '../../fixtures/transport/envelopes';

const signalDataSchema = z.object({ signalCount: z.number().int().nonnegative() }).strict();

const jsonResponse = (body: unknown, status = 200, contentType = 'application/json'): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': contentType },
    status,
  });

const captureAppError = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error)).toBe(true);

    if (isAppError(error)) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected fetchJson to reject');
};

describe('fetchJson', () => {
  it('performs one same-origin GET and returns a schema-validated success envelope', async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn<JsonFetcher>(async () => jsonResponse(validSuccessEnvelopeFixture));

    const result = await fetchJson('/api/signals?region=seoul', signalDataSchema, {
      fetcher,
      signal,
    });

    expect(result).toEqual(validSuccessEnvelopeFixture);
    expect(result.data.signalCount).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/signals?region=seoul', {
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      signal,
    });
  });

  it('lets each domain schema decide whether null and empty data are valid', async () => {
    const nullableSchema = z.union([z.null(), z.array(z.string())]);

    for (const data of [null, []]) {
      const fetcher = vi.fn<JsonFetcher>(async () => jsonResponse({ ...validSuccessEnvelopeFixture, data }));

      await expect(fetchJson('/api/domain-empty', nullableSchema, { fetcher })).resolves.toMatchObject({ data });
    }
  });

  it('converts a valid non-2xx envelope into an AppError with response context', async () => {
    const fields = { bbox: ['must contain four finite coordinates'] };
    const fetcher = vi.fn<JsonFetcher>(async () =>
      jsonResponse(
        {
          error: {
            code: 'UNPROCESSABLE_CONTENT',
            fields,
            requestId: 'req-error-1',
          },
        },
        422,
        'application/problem+json; charset=utf-8',
      ),
    );

    const error = await captureAppError(fetchJson('/api/signals', signalDataSchema, { fetcher }));

    expect(error).toMatchObject({
      code: 'UNPROCESSABLE_CONTENT',
      fields,
      requestId: 'req-error-1',
      status: 422,
    });
  });

  it('rejects an error code whose canonical status disagrees with the response', async () => {
    const fetcher = vi.fn<JsonFetcher>(async () =>
      jsonResponse({ error: { code: 'BAD_REQUEST', requestId: 'req-mismatch' } }, 503),
    );

    const error = await captureAppError(fetchJson('/api/signals', signalDataSchema, { fetcher }));

    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 503 });
  });

  it.each([
    {
      name: 'a non-JSON media type',
      response: () => new Response('{}', { headers: { 'content-type': 'text/plain' }, status: 200 }),
      status: 200,
    },
    {
      name: 'invalid JSON',
      response: () => new Response('{', { headers: { 'content-type': 'application/json' }, status: 200 }),
      status: 200,
    },
    {
      name: 'a malformed success envelope',
      response: () => jsonResponse({ data: { signalCount: 3 } }),
      status: 200,
    },
    {
      name: 'a malformed error envelope',
      response: () => jsonResponse({ error: { code: 'BAD_REQUEST', message: 'unsafe' } }, 400),
      status: 400,
    },
    {
      name: 'a 204 response',
      response: () => new Response(null, { status: 204 }),
      status: 204,
    },
    {
      name: 'a 304 response',
      response: () => new Response(null, { status: 304 }),
      status: 304,
    },
  ])('normalizes $name as INVALID_RESPONSE', async ({ response, status }) => {
    const fetcher = vi.fn<JsonFetcher>(async () => response());

    const error = await captureAppError(fetchJson('/api/signals', signalDataSchema, { fetcher }));

    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('normalizes a network failure once without retrying inside the transport', async () => {
    const cause = new TypeError('offline');
    const fetcher = vi.fn<JsonFetcher>(async () => {
      throw cause;
    });

    const error = await captureAppError(fetchJson('/api/signals', signalDataSchema, { fetcher }));

    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    expect(error.cause).toBe(cause);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('normalizes a network failure while reading the response body', async () => {
    const cause = new TypeError('terminated');
    const response = jsonResponse(validSuccessEnvelopeFixture);
    vi.spyOn(response, 'json').mockRejectedValue(cause);
    const fetcher = vi.fn<JsonFetcher>(async () => response);

    const error = await captureAppError(fetchJson('/api/signals', signalDataSchema, { fetcher }));

    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    expect(error.cause).toBe(cause);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves an AbortError by identity', async () => {
    const abortError = new DOMException('cancelled', 'AbortError');
    const fetcher = vi.fn<JsonFetcher>(async () => {
      throw abortError;
    });

    await expect(fetchJson('/api/signals', signalDataSchema, { fetcher })).rejects.toBe(abortError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves an AbortError raised while reading the response body', async () => {
    const abortError = new DOMException('cancelled while reading', 'AbortError');
    const response = jsonResponse(validSuccessEnvelopeFixture);
    vi.spyOn(response, 'json').mockRejectedValue(abortError);
    const fetcher = vi.fn<JsonFetcher>(async () => response);

    await expect(fetchJson('/api/signals', signalDataSchema, { fetcher })).rejects.toBe(abortError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://provider.example/api/signals',
    '//provider.example/api/signals',
    'api/signals',
    '/signals',
    '/api',
    '/api/../admin',
    '/api/%2e%2e/admin',
    '/api/%25252e%25252e/admin',
    '/api\\..\\admin',
  ])('rejects the forbidden path %s before calling fetch', async (path) => {
    const fetcher = vi.fn<JsonFetcher>(async () => jsonResponse(validSuccessEnvelopeFixture));

    const error = await captureAppError(fetchJson(path, signalDataSchema, { fetcher }));

    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
