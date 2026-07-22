import { randomUUID } from 'node:crypto';

export function createServiceUnavailableResponse(): Response {
  const requestId = randomUUID();

  return new Response(
    JSON.stringify({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        requestId,
      },
    }),
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Request-Id': requestId,
      },
      status: 503,
    },
  );
}
