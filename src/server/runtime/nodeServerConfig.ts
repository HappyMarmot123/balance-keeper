import { createSafeNodeRequestUrl } from './nodeHttpAdapter';
import type { RuntimeEnvironment } from './runtimeConfig';

export type NodeServerConfig = Readonly<{
  host: string;
  origin: string;
  port: number;
  shutdownTimeoutMs: number;
}>;

const readPositiveDecimal = (
  environment: RuntimeEnvironment,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  const configured = environment[name]?.trim() ?? '';

  if (configured.length === 0) {
    return fallback;
  }

  if (!/^[1-9][0-9]*$/.test(configured)) {
    throw new RangeError(`${name} must be a positive decimal integer`);
  }

  const value = Number(configured);

  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new RangeError(`${name} is outside its supported range`);
  }

  return value;
};

export function readNodeServerConfig(environment: RuntimeEnvironment): NodeServerConfig {
  const host = environment.BK_API_HOST?.trim() || '0.0.0.0';

  if (/\s/.test(host)) {
    throw new TypeError('BK_API_HOST must not contain whitespace');
  }

  const port = readPositiveDecimal(environment, 'BK_API_PORT', 8_787, 65_535);
  const configuredOrigin = environment.BK_API_ORIGIN?.trim() || `http://127.0.0.1:${port}`;
  const origin = createSafeNodeRequestUrl(configuredOrigin, '/').origin;

  return Object.freeze({
    host,
    origin,
    port,
    shutdownTimeoutMs: readPositiveDecimal(environment, 'BK_SHUTDOWN_TIMEOUT_MS', 10_000),
  });
}
