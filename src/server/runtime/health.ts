const HEALTH_CACHE_CONTROL = 'no-store';

export function isHealthCheckRequest(request: Request): boolean {
  return new URL(request.url).pathname === '/healthz';
}

export function createHealthCheckResponse(request: Request): Response {
  const headers = new Headers({
    'Cache-Control': HEALTH_CACHE_CONTROL,
    'Content-Type': 'application/json; charset=utf-8',
  });

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD');
    return new Response('{"status":"method-not-allowed"}', { headers, status: 405 });
  }

  return new Response(request.method === 'HEAD' ? null : '{"status":"ok"}', { headers, status: 200 });
}
