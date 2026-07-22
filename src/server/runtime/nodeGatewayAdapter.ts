import type { GatewayRuntime } from './createGatewayRuntime';
import { createHealthCheckResponse, isHealthCheckRequest } from './health';
import { getProductionGatewayRuntime, ProductionRuntimeConfigurationError } from './productionRuntime';
import { createServiceUnavailableResponse } from './serviceUnavailableResponse';
import { withTrustedAdmissionSubject } from './trustedAdmissionSubject';

export async function handleNodeGatewayRequest(
  request: Request,
  remoteAddress: string | null,
  runtime?: GatewayRuntime,
): Promise<Response> {
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

  return activeRuntime.handle(withTrustedAdmissionSubject(request, remoteAddress));
}
