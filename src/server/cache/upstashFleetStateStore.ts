import { Redis } from '@upstash/redis';
import { canonicalJson } from './canonicalJson';
import type {
  AllowedBreakerPermit,
  BreakerOutcome,
  BreakerPermit,
  BreakerPolicy,
  FixedWindowConsumption,
  FixedWindowPolicy,
  FleetStateStore,
  LeaseGuardedCacheDelete,
  LeaseGuardedCacheWrite,
} from './fleetStateStore';

const releaseLeaseScript = `#!lua flags=allow-key-locking
-- bk:release-lease:v1
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0`;

const fencedCacheWriteScript = `#!lua flags=allow-key-locking
-- bk:fenced-cache-write:v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1`;

const fencedCacheDeleteScript = `#!lua flags=allow-key-locking
-- bk:fenced-cache-delete:v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[2])
return 1`;

const fixedWindowScript = `#!lua flags=allow-key-locking
-- bk:fixed-window:v1
local maxSafeInteger = 9007199254740991
local serverTime = redis.call('TIME')
local now = tonumber(serverTime[1]) * 1000 + math.floor(tonumber(serverTime[2]) / 1000)
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
if not now or now < 0 or now > maxSafeInteger or not limit or limit <= 0 or limit % 1 ~= 0 or not windowMs or windowMs <= 0 or windowMs % 1 ~= 0 or windowMs > maxSafeInteger - now then
  return redis.error_reply('invalid fixed-window arguments')
end

local raw = redis.call('GET', KEYS[1])
local count
local resetAt
if raw then
  local decoded, state = pcall(cjson.decode, raw)
  if not decoded or type(state) ~= 'table' then
    return redis.error_reply('invalid fixed-window state')
  end
  count = state.count
  resetAt = state.resetAt
  if type(count) ~= 'number' or count < 1 or count % 1 ~= 0 or type(resetAt) ~= 'number' or resetAt < 0 or resetAt % 1 ~= 0 then
    return redis.error_reply('invalid fixed-window state')
  end
end

if not raw or now >= resetAt then
  count = 1
  resetAt = now + windowMs
else
  count = count + 1
end

local allowed = 0
if count <= limit then
  allowed = 1
end
local remaining = math.max(0, limit - count)
local retryAfterMs = 0
if allowed == 0 then
  retryAfterMs = resetAt - now
end
local ttl = resetAt - now
local encoded = cjson.encode({ count = count, resetAt = resetAt })
redis.call('SET', KEYS[1], encoded, 'PX', ttl)
return { allowed, count, remaining, resetAt, retryAfterMs, now }`;

const breakerAcquireScript = `#!lua flags=allow-key-locking
-- bk:breaker-acquire:v1
local maxSafeInteger = 9007199254740991
local serverTime = redis.call('TIME')
local now = tonumber(serverTime[1]) * 1000 + math.floor(tonumber(serverTime[2]) / 1000)
local candidateToken = ARGV[1]
local halfOpenLeaseMs = tonumber(ARGV[2])
local stateTtlMs = tonumber(ARGV[3])
if not now or now < 0 or now > maxSafeInteger or not candidateToken or not halfOpenLeaseMs or halfOpenLeaseMs <= 0 or halfOpenLeaseMs % 1 ~= 0 or not stateTtlMs or stateTtlMs <= halfOpenLeaseMs or stateTtlMs % 1 ~= 0 or stateTtlMs > maxSafeInteger - now then
  return redis.error_reply('invalid breaker-acquire arguments')
end

local function save(state)
  local encoded = cjson.encode(state)
  redis.call('SET', KEYS[1], encoded, 'PX', stateTtlMs)
end

local raw = redis.call('GET', KEYS[1])
local state
if raw then
  local decoded, parsed = pcall(cjson.decode, raw)
  if not decoded or type(parsed) ~= 'table' then
    return redis.error_reply('invalid breaker state')
  end
  state = parsed
else
  state = {
    phase = 'CLOSED',
    token = candidateToken,
    failures = 0,
    failureWindowEndsAt = cjson.null,
  }
end

if state.phase == 'CLOSED' then
  local failureWindowEndsAt = state.failureWindowEndsAt
  local hasFailureWindow = failureWindowEndsAt ~= nil and failureWindowEndsAt ~= cjson.null
  if type(state.token) ~= 'string' or type(state.failures) ~= 'number' or state.failures < 0 or state.failures % 1 ~= 0 then
    return redis.error_reply('invalid CLOSED breaker state')
  end
  if hasFailureWindow and (type(failureWindowEndsAt) ~= 'number' or failureWindowEndsAt < 0 or failureWindowEndsAt > maxSafeInteger or failureWindowEndsAt % 1 ~= 0) then
    return redis.error_reply('invalid CLOSED breaker window')
  end
  if (state.failures == 0 and hasFailureWindow) or (state.failures > 0 and not hasFailureWindow) then
    return redis.error_reply('inconsistent CLOSED breaker state')
  end

  if hasFailureWindow and now >= failureWindowEndsAt then
    state = {
      phase = 'CLOSED',
      token = state.token,
      failures = 0,
      failureWindowEndsAt = cjson.null,
    }
  end
  save(state)
  return { 1, 'CLOSED', 'bk-token:' .. state.token, 0, 0, now }
end

if state.phase == 'OPEN' then
  if type(state.openUntil) ~= 'number' or state.openUntil < 0 or state.openUntil > maxSafeInteger or state.openUntil % 1 ~= 0 then
    return redis.error_reply('invalid OPEN breaker state')
  end
  if now < state.openUntil then
    save(state)
    return { 0, 'OPEN', '', state.openUntil - now, state.openUntil, now }
  end
end

if state.phase == 'HALF_OPEN' then
  if type(state.token) ~= 'string' or type(state.leaseUntil) ~= 'number' or state.leaseUntil < 0 or state.leaseUntil > maxSafeInteger or state.leaseUntil % 1 ~= 0 then
    return redis.error_reply('invalid HALF_OPEN breaker state')
  end
  if now < state.leaseUntil then
    save(state)
    return { 0, 'HALF_OPEN', '', state.leaseUntil - now, state.leaseUntil, now }
  end
elseif state.phase ~= 'OPEN' then
  return redis.error_reply('unknown breaker phase')
end

local leaseUntil = now + halfOpenLeaseMs
state = { phase = 'HALF_OPEN', token = candidateToken, leaseUntil = leaseUntil }
save(state)
return { 1, 'HALF_OPEN', 'bk-token:' .. candidateToken, 0, leaseUntil, now }`;

const breakerCompleteScript = `#!lua flags=allow-key-locking
-- bk:breaker-complete:v1
local maxSafeInteger = 9007199254740991
local serverTime = redis.call('TIME')
local now = tonumber(serverTime[1]) * 1000 + math.floor(tonumber(serverTime[2]) / 1000)
local permitState = ARGV[1]
local permitToken = ARGV[2]
local outcome = ARGV[3]
local failureThreshold = tonumber(ARGV[4])
local failureWindowMs = tonumber(ARGV[5])
local cooldownMs = tonumber(ARGV[6])
local stateTtlMs = tonumber(ARGV[7])
if not now or now < 0 or now > maxSafeInteger or not permitState or not permitToken or not outcome or not failureThreshold or failureThreshold <= 0 or failureThreshold % 1 ~= 0 or not failureWindowMs or failureWindowMs <= 0 or failureWindowMs % 1 ~= 0 or not cooldownMs or cooldownMs <= 0 or cooldownMs % 1 ~= 0 or not stateTtlMs or stateTtlMs <= math.max(failureWindowMs, cooldownMs) or stateTtlMs % 1 ~= 0 or stateTtlMs > maxSafeInteger - now then
  return redis.error_reply('invalid breaker-complete arguments')
end
if (permitState ~= 'CLOSED' and permitState ~= 'HALF_OPEN') or (outcome ~= 'SUCCESS' and outcome ~= 'FAILURE' and outcome ~= 'NEUTRAL') then
  return redis.error_reply('invalid breaker completion')
end

local function save(state)
  local encoded = cjson.encode(state)
  redis.call('SET', KEYS[1], encoded, 'PX', stateTtlMs)
end

local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local decoded, state = pcall(cjson.decode, raw)
if not decoded or type(state) ~= 'table' then
  return redis.error_reply('invalid breaker state')
end

if state.phase == 'CLOSED' then
  local failureWindowEndsAt = state.failureWindowEndsAt
  local hasFailureWindow = failureWindowEndsAt ~= nil and failureWindowEndsAt ~= cjson.null
  if type(state.token) ~= 'string' or type(state.failures) ~= 'number' or state.failures < 0 or state.failures % 1 ~= 0 then
    return redis.error_reply('invalid CLOSED breaker state')
  end
  if hasFailureWindow and (type(failureWindowEndsAt) ~= 'number' or failureWindowEndsAt < 0 or failureWindowEndsAt > maxSafeInteger or failureWindowEndsAt % 1 ~= 0) then
    return redis.error_reply('invalid CLOSED breaker window')
  end
  if (state.failures == 0 and hasFailureWindow) or (state.failures > 0 and not hasFailureWindow) then
    return redis.error_reply('inconsistent CLOSED breaker state')
  end
elseif state.phase == 'OPEN' then
  if type(state.openUntil) ~= 'number' or state.openUntil < 0 or state.openUntil > maxSafeInteger or state.openUntil % 1 ~= 0 then
    return redis.error_reply('invalid OPEN breaker state')
  end
elseif state.phase == 'HALF_OPEN' then
  if type(state.token) ~= 'string' or type(state.leaseUntil) ~= 'number' or state.leaseUntil < 0 or state.leaseUntil > maxSafeInteger or state.leaseUntil % 1 ~= 0 then
    return redis.error_reply('invalid HALF_OPEN breaker state')
  end
else
  return redis.error_reply('unknown breaker phase')
end

if permitState == 'CLOSED' then
  if state.phase ~= 'CLOSED' or state.token ~= permitToken then
    return 0
  end

  local failureWindowEndsAt = state.failureWindowEndsAt
  if failureWindowEndsAt ~= nil and failureWindowEndsAt ~= cjson.null and now >= failureWindowEndsAt then
    state = {
      phase = 'CLOSED',
      token = state.token,
      failures = 0,
      failureWindowEndsAt = cjson.null,
    }
  end

  if outcome == 'NEUTRAL' then
    save(state)
    return 1
  end
  if outcome == 'SUCCESS' then
    state.failures = 0
    state.failureWindowEndsAt = cjson.null
    save(state)
    return 1
  end

  if state.failures == 0 then
    state.failureWindowEndsAt = now + failureWindowMs
  end
  state.failures = state.failures + 1
  if state.failures >= failureThreshold then
    state = { phase = 'OPEN', openUntil = now + cooldownMs }
  end
  save(state)
  return 1
end

if state.phase ~= 'HALF_OPEN' or state.token ~= permitToken or now >= state.leaseUntil then
  return 0
end
if outcome == 'SUCCESS' then
  state = {
    phase = 'CLOSED',
    token = permitToken,
    failures = 0,
    failureWindowEndsAt = cjson.null,
  }
elseif outcome == 'FAILURE' then
  state = { phase = 'OPEN', openUntil = now + cooldownMs }
else
  state = { phase = 'OPEN', openUntil = now }
end
save(state)
return 1`;

const assertPositiveInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
};

const assertToken = (token: string, label: string): void => {
  if (token.length === 0 || token.length > 256) {
    throw new TypeError(`${label} must contain between 1 and 256 characters`);
  }
};

const assertBreakerPolicy = (policy: BreakerPolicy): number => {
  assertPositiveInteger(policy.failureThreshold, 'Breaker failure threshold');
  assertPositiveInteger(policy.failureWindowMs, 'Breaker failure window');
  assertPositiveInteger(policy.cooldownMs, 'Breaker cooldown');
  assertPositiveInteger(policy.halfOpenLeaseMs, 'Breaker half-open lease');
  assertPositiveInteger(policy.closedCompletionBoundMs, 'Breaker closed completion bound');
  assertPositiveInteger(policy.stateRetentionMs, 'Breaker state retention');

  if (
    policy.stateRetentionMs <=
    Math.max(policy.failureWindowMs, policy.cooldownMs, policy.halfOpenLeaseMs, policy.closedCompletionBoundMs)
  ) {
    throw new RangeError('Breaker state retention must exceed every active breaker duration');
  }

  return policy.stateRetentionMs;
};

const assertBreakerOutcome = (outcome: BreakerOutcome): void => {
  if (outcome !== 'SUCCESS' && outcome !== 'FAILURE' && outcome !== 'NEUTRAL') {
    throw new TypeError('Unknown breaker completion outcome');
  }
};

const parseBinaryResult = (result: unknown, label: string): boolean => {
  if (result === 1) {
    return true;
  }

  if (result === 0) {
    return false;
  }

  throw new TypeError(`${label} returned a malformed result`);
};

const isNonNegativeSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

const isValidToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;

const breakerTokenResultPrefix = 'bk-token:';

const parseBreakerToken = (value: unknown): string => {
  if (typeof value !== 'string' || !value.startsWith(breakerTokenResultPrefix)) {
    throw new TypeError('Breaker acquire EVAL returned a malformed token');
  }

  const token = value.slice(breakerTokenResultPrefix.length);
  if (!isValidToken(token)) {
    throw new TypeError('Breaker acquire EVAL returned a malformed token');
  }

  return token;
};

const parseFixedWindowResult = (result: unknown, policy: FixedWindowPolicy): FixedWindowConsumption => {
  if (!Array.isArray(result) || result.length !== 6) {
    throw new TypeError('Fixed-window EVAL returned a malformed result');
  }

  const [rawAllowed, count, remaining, resetAt, retryAfterMs, serverNow] = result;
  const allowed = parseBinaryResult(rawAllowed, 'Fixed-window EVAL');
  const expectedAllowed = isNonNegativeSafeInteger(count) && count <= policy.limit;

  if (
    !isNonNegativeSafeInteger(count) ||
    count < 1 ||
    !isNonNegativeSafeInteger(remaining) ||
    !isNonNegativeSafeInteger(resetAt) ||
    !isNonNegativeSafeInteger(serverNow) ||
    resetAt <= serverNow ||
    !isNonNegativeSafeInteger(retryAfterMs) ||
    allowed !== expectedAllowed ||
    remaining !== Math.max(0, policy.limit - count) ||
    retryAfterMs !== (allowed ? 0 : resetAt - serverNow)
  ) {
    throw new TypeError('Fixed-window EVAL returned inconsistent fields');
  }

  return { allowed, count, remaining, resetAt, retryAfterMs };
};

const parseBreakerPermitResult = (result: unknown, policy: BreakerPolicy): BreakerPermit => {
  if (!Array.isArray(result) || result.length !== 6) {
    throw new TypeError('Breaker acquire EVAL returned a malformed result');
  }

  const [rawAllowed, state, rawToken, retryAfterMs, deadline, serverNow] = result;
  const allowed = parseBinaryResult(rawAllowed, 'Breaker acquire EVAL');
  if (
    !isNonNegativeSafeInteger(retryAfterMs) ||
    !isNonNegativeSafeInteger(deadline) ||
    !isNonNegativeSafeInteger(serverNow)
  ) {
    throw new TypeError('Breaker acquire EVAL returned inconsistent fields');
  }

  if (allowed) {
    if (retryAfterMs !== 0) {
      throw new TypeError('Breaker acquire EVAL returned inconsistent allowed fields');
    }
    const token = parseBreakerToken(rawToken);

    if (state === 'CLOSED' && deadline === 0) {
      return { allowed: true, state, token };
    }

    if (state === 'HALF_OPEN' && deadline > serverNow && deadline - serverNow === policy.halfOpenLeaseMs) {
      return { allowed: true, state, token };
    }

    throw new TypeError('Breaker acquire EVAL returned an inconsistent allowed state');
  }

  if (
    (state !== 'OPEN' && state !== 'HALF_OPEN') ||
    rawToken !== '' ||
    retryAfterMs <= 0 ||
    deadline <= serverNow ||
    retryAfterMs !== deadline - serverNow
  ) {
    throw new TypeError('Breaker acquire EVAL returned inconsistent denied fields');
  }

  return { allowed: false, state, retryAfterMs };
};

export type UpstashRedisClientOptions = Readonly<{
  url: string;
  token: string;
  requestTimeoutMs: number;
}>;

export function createUpstashRedisClient(options: UpstashRedisClientOptions): Redis {
  if (options.url.trim().length === 0 || options.token.trim().length === 0) {
    throw new TypeError('Upstash URL and token must be provided explicitly');
  }

  if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
    throw new RangeError('Upstash request timeout must be a positive safe integer');
  }

  return new Redis({
    url: options.url,
    token: options.token,
    retry: { retries: 0 },
    signal: () => AbortSignal.timeout(options.requestTimeoutMs),
    enableTelemetry: false,
    enableAutoPipelining: false,
    latencyLogging: false,
  });
}

export type UpstashSetOptions = Readonly<{ px: number; nx: true }> | Readonly<{ px: number; nx?: never }>;

export interface UpstashCommandClient {
  get<Data = unknown>(key: string): Promise<Data | null>;
  set<Data>(key: string, value: Data, options: UpstashSetOptions): Promise<'OK' | Data | null>;
  del(key: string): Promise<number>;
  eval<Args extends unknown[], Data = unknown>(script: string, keys: string[], args: Args): Promise<Data>;
}

export class UpstashFleetStateStore implements FleetStateStore {
  constructor(private readonly client: UpstashCommandClient) {}

  async readCache(_key: string): Promise<unknown | null> {
    return this.client.get(_key);
  }

  async writeCache(key: string, value: unknown, ttlMs: number): Promise<void> {
    assertPositiveInteger(ttlMs, 'Cache TTL');
    const result = await this.client.set(key, canonicalJson(value), { px: ttlMs });

    if (result !== 'OK') {
      throw new TypeError('Cache SET returned a malformed result');
    }
  }

  async deleteCache(key: string): Promise<boolean> {
    return parseBinaryResult(await this.client.del(key), 'Cache DEL');
  }

  async tryAcquireLease(key: string, token: string, ttlMs: number): Promise<boolean> {
    assertToken(token, 'Lease token');
    assertPositiveInteger(ttlMs, 'Lease TTL');
    const result = await this.client.set(key, token, { nx: true, px: ttlMs });

    if (result === 'OK') {
      return true;
    }

    if (result === null) {
      return false;
    }

    throw new TypeError('Lease SET returned a malformed result');
  }

  async releaseLease(key: string, token: string): Promise<boolean> {
    assertToken(token, 'Lease token');
    const result = await this.client.eval(releaseLeaseScript, [key], [token]);
    return parseBinaryResult(result, 'Lease release EVAL');
  }

  async writeCacheIfLeaseOwner(write: LeaseGuardedCacheWrite): Promise<boolean> {
    assertToken(write.leaseToken, 'Lease token');
    assertPositiveInteger(write.ttlMs, 'Cache TTL');
    const serializedValue = canonicalJson(write.value);
    const result = await this.client.eval(
      fencedCacheWriteScript,
      [write.leaseKey, write.cacheKey],
      [write.leaseToken, serializedValue, write.ttlMs],
    );
    return parseBinaryResult(result, 'Fenced cache write EVAL');
  }

  async deleteCacheIfLeaseOwner(deletion: LeaseGuardedCacheDelete): Promise<boolean> {
    assertToken(deletion.leaseToken, 'Lease token');
    const result = await this.client.eval(
      fencedCacheDeleteScript,
      [deletion.leaseKey, deletion.cacheKey],
      [deletion.leaseToken],
    );
    return parseBinaryResult(result, 'Fenced cache delete EVAL');
  }

  async consumeFixedWindow(key: string, policy: FixedWindowPolicy): Promise<FixedWindowConsumption> {
    assertPositiveInteger(policy.limit, 'Fixed-window limit');
    assertPositiveInteger(policy.windowMs, 'Fixed-window duration');
    const result = await this.client.eval(fixedWindowScript, [key], [policy.limit, policy.windowMs]);
    return parseFixedWindowResult(result, policy);
  }

  async acquireBreaker(_key: string, _candidateToken: string, _policy: BreakerPolicy): Promise<BreakerPermit> {
    assertToken(_candidateToken, 'Breaker candidate token');
    const stateTtlMs = assertBreakerPolicy(_policy);
    const result = await this.client.eval(
      breakerAcquireScript,
      [_key],
      [_candidateToken, _policy.halfOpenLeaseMs, stateTtlMs],
    );
    return parseBreakerPermitResult(result, _policy);
  }

  async completeBreaker(
    _key: string,
    _permit: AllowedBreakerPermit,
    _outcome: BreakerOutcome,
    _policy: BreakerPolicy,
  ): Promise<boolean> {
    if (_permit.allowed !== true || (_permit.state !== 'CLOSED' && _permit.state !== 'HALF_OPEN')) {
      throw new TypeError('Breaker completion requires an allowed permit');
    }
    assertToken(_permit.token, 'Breaker permit token');
    assertBreakerOutcome(_outcome);
    const stateTtlMs = assertBreakerPolicy(_policy);
    const result = await this.client.eval(
      breakerCompleteScript,
      [_key],
      [
        _permit.state,
        _permit.token,
        _outcome,
        _policy.failureThreshold,
        _policy.failureWindowMs,
        _policy.cooldownMs,
        stateTtlMs,
      ],
    );
    return parseBinaryResult(result, 'Breaker complete EVAL');
  }
}
