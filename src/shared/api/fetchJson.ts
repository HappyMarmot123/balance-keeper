import type { z } from 'zod';

import { AppError, statusForApiErrorCode } from '../contracts/AppError';
import { errorEnvelopeSchema, type SuccessEnvelope, successEnvelopeSchema } from '../contracts/transport';

export type JsonFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FetchJsonOptions = Readonly<{
  fetcher?: JsonFetcher;
  signal?: AbortSignal;
}>;

const validationOrigin = 'https://balance-keeper.invalid';

const invalidResponse = (status = 0, cause?: unknown): AppError => new AppError('INVALID_RESPONSE', { cause, status });

const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';

const hasTraversalSegment = (pathname: string): boolean => {
  let decodedPathname = pathname.replaceAll('\\', '/');

  for (let pass = 0; pass < 4; pass += 1) {
    if (decodedPathname.split('/').some((segment) => segment === '.' || segment === '..')) {
      return true;
    }

    const nextPathname = decodeURIComponent(decodedPathname).replaceAll('\\', '/');

    if (nextPathname === decodedPathname) {
      return false;
    }

    decodedPathname = nextPathname;
  }

  return true;
};

const assertApiPath = (path: string): void => {
  if (!path.startsWith('/api/') || path.includes('#')) {
    throw invalidResponse();
  }

  const rawPathname = path.split('?', 1)[0];

  try {
    if (rawPathname === undefined || hasTraversalSegment(rawPathname)) {
      throw invalidResponse();
    }

    const normalizedUrl = new URL(path, validationOrigin);

    if (normalizedUrl.origin !== validationOrigin || !normalizedUrl.pathname.startsWith('/api/')) {
      throw invalidResponse();
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw invalidResponse(0, error);
  }
};

const isJsonMediaType = (contentType: string | null): boolean => {
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();

  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
};

export async function fetchJson<DataSchema extends z.ZodType>(
  path: string,
  dataSchema: DataSchema,
  options: FetchJsonOptions = {},
): Promise<SuccessEnvelope<DataSchema>> {
  assertApiPath(path);

  const fetcher = options.fetcher ?? globalThis.fetch;
  let response: Response;

  try {
    response = await fetcher(path, {
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new AppError('NETWORK_ERROR', { cause: error });
  }

  if (response.status === 204 || response.status === 304 || !isJsonMediaType(response.headers.get('content-type'))) {
    throw invalidResponse(response.status);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (error instanceof TypeError) {
      throw new AppError('NETWORK_ERROR', { cause: error });
    }

    throw invalidResponse(response.status, error);
  }

  if (response.ok) {
    const parsedEnvelope = successEnvelopeSchema(dataSchema).safeParse(payload);

    if (!parsedEnvelope.success) {
      throw invalidResponse(response.status, parsedEnvelope.error);
    }

    return parsedEnvelope.data;
  }

  const parsedEnvelope = errorEnvelopeSchema.safeParse(payload);

  if (!parsedEnvelope.success || statusForApiErrorCode(parsedEnvelope.data.error.code) !== response.status) {
    throw invalidResponse(response.status, parsedEnvelope.success ? undefined : parsedEnvelope.error);
  }

  throw new AppError(parsedEnvelope.data.error.code, {
    fields: parsedEnvelope.data.error.fields,
    requestId: parsedEnvelope.data.error.requestId,
    status: response.status,
  });
}
