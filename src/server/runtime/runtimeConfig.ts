export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type FleetStateRuntimeConfig =
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{
      kind: 'upstash';
      url: string;
      token: string;
      requestTimeoutMs: number;
    }>;

const DEFAULT_UPSTASH_REQUEST_TIMEOUT_MS = 2_500;

const readTrimmed = (environment: RuntimeEnvironment, name: string): string => environment[name]?.trim() ?? '';

const readRequestTimeout = (environment: RuntimeEnvironment): number => {
  const configured = readTrimmed(environment, 'UPSTASH_REQUEST_TIMEOUT_MS');
  const requestTimeoutMs =
    configured.length === 0
      ? DEFAULT_UPSTASH_REQUEST_TIMEOUT_MS
      : /^[1-9][0-9]*$/.test(configured)
        ? Number(configured)
        : Number.NaN;

  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError('Upstash request timeout must be a positive safe integer');
  }

  return requestTimeoutMs;
};

const parseUpstashOrigin = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Upstash URL must be a valid HTTPS origin');
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError('Upstash URL must be a valid HTTPS origin');
  }

  return url.origin;
};

export function readFleetStateConfig(environment: RuntimeEnvironment): FleetStateRuntimeConfig {
  const url = readTrimmed(environment, 'UPSTASH_REDIS_REST_URL');
  const token = readTrimmed(environment, 'UPSTASH_REDIS_REST_TOKEN');

  if (url.length === 0 && token.length === 0) {
    return { kind: 'unavailable' };
  }

  if (url.length === 0 || token.length === 0) {
    throw new TypeError('Upstash URL and token must be configured together');
  }

  return {
    kind: 'upstash',
    url: parseUpstashOrigin(url),
    token,
    requestTimeoutMs: readRequestTimeout(environment),
  };
}
