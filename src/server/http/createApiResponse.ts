import { matchesIfNoneMatch } from './conditionalRequest';

const BROWSER_REVALIDATE = 'public, max-age=0, must-revalidate';
const supportedJsonBodyStatuses: ReadonlySet<number> = new Set([200, 400, 401, 403, 404, 422, 429, 500, 502, 503]);

export type JsonPrimitive = null | boolean | number | string;
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

type BaseApiResponseOptions = Readonly<{
  body: JsonValue;
  requestId: string;
}>;

export type JsonBodyStatus = 200 | 400 | 401 | 403 | 404 | 422 | 429 | 500 | 502 | 503;

export type CurrentApiResponseOptions = BaseApiResponseOptions &
  Readonly<{
    cache: 'current';
    etag: string;
    ifNoneMatch: string | null;
    status: 200;
  }>;

export type NoStoreApiResponseOptions = BaseApiResponseOptions &
  Readonly<{
    cache: 'no-store';
    etag?: string;
    retryAfterSeconds?: number;
    status: JsonBodyStatus;
  }>;

export type CreateApiResponseOptions = CurrentApiResponseOptions | NoStoreApiResponseOptions;

const createBaseHeaders = (options: CreateApiResponseOptions): Headers => {
  if (!supportedJsonBodyStatuses.has(options.status)) {
    throw new TypeError('Unsupported JSON response status');
  }

  const headers = new Headers({
    'Cache-Control': options.cache === 'current' ? BROWSER_REVALIDATE : 'no-store',
    'X-Request-Id': options.requestId,
  });

  if (options.etag !== undefined) {
    headers.set('ETag', options.etag);
  }

  if (options.cache === 'no-store' && options.retryAfterSeconds !== undefined) {
    if (!Number.isSafeInteger(options.retryAfterSeconds) || options.retryAfterSeconds <= 0) {
      throw new TypeError('retryAfterSeconds must be a positive safe integer');
    }

    headers.set('Retry-After', String(options.retryAfterSeconds));
  }

  return headers;
};

const serializeJsonBody = (body: JsonValue): string => {
  try {
    const serialized = JSON.stringify(body);

    if (serialized === undefined) {
      throw new TypeError('Response body must be JSON serializable');
    }

    return serialized;
  } catch {
    throw new TypeError('Response body must be JSON serializable');
  }
};

export function createApiResponse(options: CreateApiResponseOptions): Response {
  const headers = createBaseHeaders(options);

  if (options.cache === 'current' && matchesIfNoneMatch(options.ifNoneMatch, options.etag)) {
    return new Response(null, { headers, status: 304 });
  }

  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(serializeJsonBody(options.body), {
    headers,
    status: options.status,
  });
}
