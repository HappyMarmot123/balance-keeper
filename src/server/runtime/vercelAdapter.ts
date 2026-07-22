import type { GatewayRuntime } from './createGatewayRuntime';
import { createHealthCheckResponse, isHealthCheckRequest } from './health';
import { getProductionGatewayRuntime, ProductionRuntimeConfigurationError } from './productionRuntime';
import { createServiceUnavailableResponse } from './serviceUnavailableResponse';
import { withTrustedAdmissionSubject } from './trustedAdmissionSubject';

const CURRENT_BROWSER_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const VERCEL_CDN_CACHE_CONTROL = 'Vercel-CDN-Cache-Control';

const isCacheEligibleRequest = (request: Request): boolean =>
  (request.method === 'GET' || request.method === 'HEAD') &&
  !request.headers.has('Authorization') &&
  !request.headers.has('Cookie') &&
  !request.headers.has('Range');

const decorateVercelResponse = (request: Request, response: Response, runtime: GatewayRuntime): Response => {
  const headers = new Headers(response.headers);
  headers.delete('CDN-Cache-Control');
  headers.delete(VERCEL_CDN_CACHE_CONTROL);

  const cdnMaxAgeSeconds = runtime.getCdnMaxAgeSeconds(new URL(request.url).pathname);
  const isCurrentRepresentation =
    response.headers.get('Cache-Control') === CURRENT_BROWSER_CACHE_CONTROL &&
    (response.status === 200 || response.status === 304);

  if (
    isCacheEligibleRequest(request) &&
    isCurrentRepresentation &&
    !response.headers.has('Set-Cookie') &&
    cdnMaxAgeSeconds !== undefined
  ) {
    headers.set(VERCEL_CDN_CACHE_CONTROL, `public, s-maxage=${cdnMaxAgeSeconds}`);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export async function handleVercelRequest(request: Request, runtime?: GatewayRuntime): Promise<Response> {
  if (isHealthCheckRequest(request)) {
    return createHealthCheckResponse(request);
  }

  let activeRuntime: GatewayRuntime;

  try {
    activeRuntime = runtime ?? getProductionGatewayRuntime();
  } catch (error) {
    if (error instanceof ProductionRuntimeConfigurationError) {
      return createServiceUnavailableResponse();
    }
    throw error;
  }
  const trustedRequest = withTrustedAdmissionSubject(request, request.headers.get('x-vercel-forwarded-for'));
  const response = await activeRuntime.handle(trustedRequest);
  return decorateVercelResponse(trustedRequest, response, activeRuntime);
}
