import { canonicalJson } from './canonicalJson';

export type Clock = () => number;

export type FixedWindowPolicy = Readonly<{
  limit: number;
  windowMs: number;
}>;

export type FixedWindowConsumption = Readonly<{
  allowed: boolean;
  count: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}>;

export type LeaseGuardedCacheWrite = Readonly<{
  leaseKey: string;
  leaseToken: string;
  cacheKey: string;
  value: unknown;
  ttlMs: number;
}>;

export type LeaseGuardedCacheDelete = Readonly<{
  leaseKey: string;
  leaseToken: string;
  cacheKey: string;
}>;

export type BreakerPolicy = Readonly<{
  failureThreshold: number;
  failureWindowMs: number;
  cooldownMs: number;
  halfOpenLeaseMs: number;
  closedCompletionBoundMs: number;
  stateRetentionMs: number;
}>;

export type BreakerOutcome = 'SUCCESS' | 'FAILURE' | 'NEUTRAL';

export type AllowedBreakerPermit =
  | Readonly<{ allowed: true; state: 'CLOSED'; token: string }>
  | Readonly<{ allowed: true; state: 'HALF_OPEN'; token: string }>;

export type DeniedBreakerPermit = Readonly<{
  allowed: false;
  state: 'OPEN' | 'HALF_OPEN';
  retryAfterMs: number;
}>;

export type BreakerPermit = AllowedBreakerPermit | DeniedBreakerPermit;

export interface FleetStateStore {
  readCache(key: string): Promise<unknown | null>;
  writeCache(key: string, value: unknown, ttlMs: number): Promise<void>;
  deleteCache(key: string): Promise<boolean>;
  tryAcquireLease(key: string, token: string, ttlMs: number): Promise<boolean>;
  releaseLease(key: string, token: string): Promise<boolean>;
  writeCacheIfLeaseOwner(write: LeaseGuardedCacheWrite): Promise<boolean>;
  deleteCacheIfLeaseOwner(deletion: LeaseGuardedCacheDelete): Promise<boolean>;
  consumeFixedWindow(key: string, policy: FixedWindowPolicy): Promise<FixedWindowConsumption>;
  acquireBreaker(key: string, candidateToken: string, policy: BreakerPolicy): Promise<BreakerPermit>;
  completeBreaker(
    key: string,
    permit: AllowedBreakerPermit,
    outcome: BreakerOutcome,
    policy: BreakerPolicy,
  ): Promise<boolean>;
}

type ExpiringValue<Value> = Readonly<{
  value: Value;
  expiresAt: number;
}>;

type FixedWindowCounter = {
  count: number;
  resetAt: number;
};

type ClosedBreakerState = {
  phase: 'CLOSED';
  token: string;
  failures: number;
  failureWindowEndsAt: number | null;
};

type OpenBreakerState = {
  phase: 'OPEN';
  openUntil: number;
};

type HalfOpenBreakerState = {
  phase: 'HALF_OPEN';
  token: string;
  leaseUntil: number;
};

type BreakerState = ClosedBreakerState | OpenBreakerState | HalfOpenBreakerState;

const assertPositiveDuration = (durationMs: number, label: string): void => {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
};

const assertToken = (token: string, label: string): void => {
  if (token.length === 0 || token.length > 256) {
    throw new TypeError(`${label} must contain between 1 and 256 characters`);
  }
};

const assertBreakerPolicy = (policy: BreakerPolicy): void => {
  assertPositiveDuration(policy.failureThreshold, 'Breaker failure threshold');
  assertPositiveDuration(policy.failureWindowMs, 'Breaker failure window');
  assertPositiveDuration(policy.cooldownMs, 'Breaker cooldown');
  assertPositiveDuration(policy.halfOpenLeaseMs, 'Breaker half-open lease');
  assertPositiveDuration(policy.closedCompletionBoundMs, 'Breaker closed completion bound');
  assertPositiveDuration(policy.stateRetentionMs, 'Breaker state retention');

  if (
    policy.stateRetentionMs <=
    Math.max(policy.failureWindowMs, policy.cooldownMs, policy.halfOpenLeaseMs, policy.closedCompletionBoundMs)
  ) {
    throw new RangeError('Breaker state retention must exceed every active breaker duration');
  }
};

export class MemoryFleetStateStore implements FleetStateStore {
  readonly #cache = new Map<string, ExpiringValue<string>>();
  readonly #leases = new Map<string, ExpiringValue<string>>();
  readonly #fixedWindows = new Map<string, FixedWindowCounter>();
  readonly #breakers = new Map<string, ExpiringValue<BreakerState>>();

  constructor(private readonly now: Clock) {}

  #currentTime(): number {
    const currentTime = this.now();

    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      throw new RangeError('Clock must return a non-negative safe epoch millisecond value');
    }

    return currentTime;
  }

  #expiryAfter(durationMs: number, label: string, currentTime = this.#currentTime()): number {
    assertPositiveDuration(durationMs, label);
    const expiresAt = currentTime + durationMs;

    if (!Number.isSafeInteger(expiresAt)) {
      throw new RangeError(`${label} exceeds the safe epoch millisecond range`);
    }

    return expiresAt;
  }

  async readCache(key: string): Promise<unknown | null> {
    const entry = this.#cache.get(key);

    if (!entry) {
      return null;
    }

    if (this.#currentTime() >= entry.expiresAt) {
      this.#cache.delete(key);
      return null;
    }

    return JSON.parse(entry.value) as unknown;
  }

  async writeCache(key: string, value: unknown, ttlMs: number): Promise<void> {
    const expiresAt = this.#expiryAfter(ttlMs, 'Cache TTL');
    const snapshot = canonicalJson(value);
    this.#cache.set(key, { value: snapshot, expiresAt });
  }

  async deleteCache(key: string): Promise<boolean> {
    const entry = this.#cache.get(key);

    if (!entry || this.#currentTime() >= entry.expiresAt) {
      this.#cache.delete(key);
      return false;
    }

    return this.#cache.delete(key);
  }

  async tryAcquireLease(key: string, token: string, ttlMs: number): Promise<boolean> {
    assertToken(token, 'Lease token');

    assertPositiveDuration(ttlMs, 'Lease TTL');
    const currentTime = this.#currentTime();
    const existing = this.#leases.get(key);

    if (existing && currentTime < existing.expiresAt) {
      return false;
    }

    this.#leases.set(key, {
      value: token,
      expiresAt: this.#expiryAfter(ttlMs, 'Lease TTL', currentTime),
    });
    return true;
  }

  async releaseLease(key: string, token: string): Promise<boolean> {
    const currentTime = this.#currentTime();
    const existing = this.#leases.get(key);

    if (!existing || currentTime >= existing.expiresAt) {
      this.#leases.delete(key);
      return false;
    }

    if (existing.value !== token) {
      return false;
    }

    return this.#leases.delete(key);
  }

  async writeCacheIfLeaseOwner(write: LeaseGuardedCacheWrite): Promise<boolean> {
    assertToken(write.leaseToken, 'Lease token');
    assertPositiveDuration(write.ttlMs, 'Cache TTL');
    const snapshot = canonicalJson(write.value);

    const currentTime = this.#currentTime();
    const cacheExpiresAt = this.#expiryAfter(write.ttlMs, 'Cache TTL', currentTime);
    const lease = this.#leases.get(write.leaseKey);

    if (!lease || currentTime >= lease.expiresAt) {
      this.#leases.delete(write.leaseKey);
      return false;
    }

    if (lease.value !== write.leaseToken) {
      return false;
    }

    this.#cache.set(write.cacheKey, {
      value: snapshot,
      expiresAt: cacheExpiresAt,
    });
    return true;
  }

  async deleteCacheIfLeaseOwner(deletion: LeaseGuardedCacheDelete): Promise<boolean> {
    assertToken(deletion.leaseToken, 'Lease token');
    const currentTime = this.#currentTime();
    const lease = this.#leases.get(deletion.leaseKey);

    if (!lease || currentTime >= lease.expiresAt) {
      this.#leases.delete(deletion.leaseKey);
      return false;
    }

    if (lease.value !== deletion.leaseToken) {
      return false;
    }

    this.#cache.delete(deletion.cacheKey);
    return true;
  }

  async consumeFixedWindow(key: string, policy: FixedWindowPolicy): Promise<FixedWindowConsumption> {
    assertPositiveDuration(policy.limit, 'Fixed-window limit');
    assertPositiveDuration(policy.windowMs, 'Fixed-window duration');

    const currentTime = this.#currentTime();
    const existing = this.#fixedWindows.get(key);
    let counter: FixedWindowCounter;

    if (!existing || currentTime >= existing.resetAt) {
      counter = {
        count: 1,
        resetAt: this.#expiryAfter(policy.windowMs, 'Fixed-window duration', currentTime),
      };
      this.#fixedWindows.set(key, counter);
    } else {
      existing.count += 1;
      counter = existing;
    }

    const allowed = counter.count <= policy.limit;

    return {
      allowed,
      count: counter.count,
      remaining: Math.max(0, policy.limit - counter.count),
      resetAt: counter.resetAt,
      retryAfterMs: allowed ? 0 : counter.resetAt - currentTime,
    };
  }

  async acquireBreaker(key: string, candidateToken: string, policy: BreakerPolicy): Promise<BreakerPermit> {
    assertToken(candidateToken, 'Breaker candidate token');
    assertBreakerPolicy(policy);

    const currentTime = this.#currentTime();
    const retentionUntil = this.#expiryAfter(policy.stateRetentionMs, 'Breaker state retention', currentTime);
    const entry = this.#breakers.get(key);
    let state = entry && currentTime < entry.expiresAt ? entry.value : undefined;

    if (entry && !state) {
      this.#breakers.delete(key);
    }

    if (!state) {
      state = {
        phase: 'CLOSED',
        token: candidateToken,
        failures: 0,
        failureWindowEndsAt: null,
      };
    }

    if (state.phase === 'CLOSED') {
      if (state.failureWindowEndsAt !== null && currentTime >= state.failureWindowEndsAt) {
        state = {
          phase: 'CLOSED',
          token: state.token,
          failures: 0,
          failureWindowEndsAt: null,
        };
      }

      this.#breakers.set(key, { value: state, expiresAt: retentionUntil });
      return { allowed: true, state: 'CLOSED', token: state.token };
    }

    if (state.phase === 'OPEN' && currentTime < state.openUntil) {
      this.#breakers.set(key, { value: state, expiresAt: retentionUntil });
      return {
        allowed: false,
        state: 'OPEN',
        retryAfterMs: state.openUntil - currentTime,
      };
    }

    if (state.phase === 'HALF_OPEN' && currentTime < state.leaseUntil) {
      this.#breakers.set(key, { value: state, expiresAt: retentionUntil });
      return {
        allowed: false,
        state: 'HALF_OPEN',
        retryAfterMs: state.leaseUntil - currentTime,
      };
    }

    const halfOpen: HalfOpenBreakerState = {
      phase: 'HALF_OPEN',
      token: candidateToken,
      leaseUntil: this.#expiryAfter(policy.halfOpenLeaseMs, 'Breaker half-open lease', currentTime),
    };
    this.#breakers.set(key, { value: halfOpen, expiresAt: retentionUntil });
    return { allowed: true, state: 'HALF_OPEN', token: candidateToken };
  }

  async completeBreaker(
    key: string,
    permit: AllowedBreakerPermit,
    outcome: BreakerOutcome,
    policy: BreakerPolicy,
  ): Promise<boolean> {
    assertBreakerPolicy(policy);

    if (!['SUCCESS', 'FAILURE', 'NEUTRAL'].includes(outcome)) {
      throw new TypeError('Unknown breaker completion outcome');
    }

    const currentTime = this.#currentTime();
    const retentionUntil = this.#expiryAfter(policy.stateRetentionMs, 'Breaker state retention', currentTime);
    const entry = this.#breakers.get(key);

    if (!entry || currentTime >= entry.expiresAt) {
      this.#breakers.delete(key);
      return false;
    }

    let state = entry.value;

    if (permit.state === 'CLOSED') {
      if (state.phase !== 'CLOSED' || state.token !== permit.token) {
        return false;
      }

      if (state.failureWindowEndsAt !== null && currentTime >= state.failureWindowEndsAt) {
        state = {
          phase: 'CLOSED',
          token: state.token,
          failures: 0,
          failureWindowEndsAt: null,
        };
      }

      if (outcome === 'NEUTRAL') {
        this.#breakers.set(key, { value: state, expiresAt: retentionUntil });
        return true;
      }

      if (outcome === 'SUCCESS') {
        state.failures = 0;
        state.failureWindowEndsAt = null;
        this.#breakers.set(key, { value: state, expiresAt: retentionUntil });
        return true;
      }

      if (state.failures === 0) {
        state.failureWindowEndsAt = this.#expiryAfter(policy.failureWindowMs, 'Breaker failure window', currentTime);
      }

      state.failures += 1;

      if (state.failures >= policy.failureThreshold) {
        state = {
          phase: 'OPEN',
          openUntil: this.#expiryAfter(policy.cooldownMs, 'Breaker cooldown', currentTime),
        };
      }

      this.#breakers.set(key, { value: state, expiresAt: retentionUntil });
      return true;
    }

    if (state.phase !== 'HALF_OPEN' || state.token !== permit.token || currentTime >= state.leaseUntil) {
      return false;
    }

    if (outcome === 'SUCCESS') {
      this.#breakers.set(key, {
        value: {
          phase: 'CLOSED',
          token: permit.token,
          failures: 0,
          failureWindowEndsAt: null,
        },
        expiresAt: retentionUntil,
      });
      return true;
    }

    this.#breakers.set(key, {
      value: {
        phase: 'OPEN',
        openUntil:
          outcome === 'FAILURE' ? this.#expiryAfter(policy.cooldownMs, 'Breaker cooldown', currentTime) : currentTime,
      },
      expiresAt: retentionUntil,
    });
    return true;
  }
}
