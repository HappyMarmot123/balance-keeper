// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Redis } from '@upstash/redis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AllowedBreakerPermit,
  BreakerOutcome,
  BreakerPermit,
  BreakerPolicy,
  UpstashCommandClient,
  UpstashSetOptions,
} from '../../../src/server/cache';
import { createUpstashRedisClient, UpstashFleetStateStore } from '../../../src/server/cache';

type RecordedCommand =
  | Readonly<{ command: 'get'; key: string }>
  | Readonly<{ command: 'set'; key: string; value: unknown; options: UpstashSetOptions }>
  | Readonly<{ command: 'del'; key: string }>
  | Readonly<{ command: 'eval'; script: string; keys: string[]; args: unknown[] }>;

class RecordingCommandClient implements UpstashCommandClient {
  readonly calls: RecordedCommand[] = [];
  readonly #results: unknown[];

  constructor(results: unknown[]) {
    this.#results = [...results];
  }

  #nextResult(): unknown {
    if (this.#results.length === 0) {
      throw new Error('Missing recorded command result');
    }

    return this.#results.shift();
  }

  async get<Data = unknown>(key: string): Promise<Data | null> {
    this.calls.push({ command: 'get', key });
    return this.#nextResult() as Data | null;
  }

  async set<Data>(key: string, value: Data, options: UpstashSetOptions): Promise<'OK' | Data | null> {
    this.calls.push({ command: 'set', key, value, options });
    return this.#nextResult() as 'OK' | Data | null;
  }

  async del(key: string): Promise<number> {
    this.calls.push({ command: 'del', key });
    return this.#nextResult() as number;
  }

  async eval<Args extends unknown[], Data = unknown>(script: string, keys: string[], args: Args): Promise<Data> {
    this.calls.push({ command: 'eval', script, keys, args });
    return this.#nextResult() as Data;
  }
}

type FakeBreakerState =
  | { phase: 'CLOSED'; token: string; failures: number; failureWindowEndsAt: number | null }
  | { phase: 'OPEN'; openUntil: number }
  | { phase: 'HALF_OPEN'; token: string; leaseUntil: number };

class LeaseAwareFakeClient implements UpstashCommandClient {
  readonly #leases = new Map<string, { token: string; expiresAt: number }>();
  readonly #cache = new Map<string, unknown>();
  readonly #fixedWindows = new Map<string, { count: number; resetAt: number }>();
  readonly #breakers = new Map<string, { state: FakeBreakerState; expiresAt: number }>();

  constructor(private readonly now: () => number) {}

  async get<Data = unknown>(key: string): Promise<Data | null> {
    return (this.#cache.get(key) as Data | undefined) ?? null;
  }

  async set<Data>(key: string, value: Data, options: UpstashSetOptions): Promise<'OK' | Data | null> {
    if (options.nx) {
      const existing = this.#leases.get(key);

      if (existing && this.now() < existing.expiresAt) {
        return null;
      }

      this.#leases.set(key, { token: String(value), expiresAt: this.now() + options.px });
      return 'OK';
    }

    this.#cache.set(key, typeof value === 'string' ? JSON.parse(value) : value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.#cache.delete(key) ? 1 : 0;
  }

  async eval<Args extends unknown[], Data = unknown>(script: string, keys: string[], args: Args): Promise<Data> {
    if (script.includes('bk:breaker-acquire:v1')) {
      return this.#acquireBreaker(keys, args) as unknown as Data;
    }

    if (script.includes('bk:breaker-complete:v1')) {
      return this.#completeBreaker(keys, args) as unknown as Data;
    }

    if (script.includes('bk:fenced-cache-delete:v1')) {
      const leaseKey = keys[0];
      const cacheKey = keys[1];
      const token = args[0];
      const lease = leaseKey ? this.#leases.get(leaseKey) : undefined;

      if (
        !leaseKey ||
        !cacheKey ||
        typeof token !== 'string' ||
        !lease ||
        this.now() >= lease.expiresAt ||
        lease.token !== token
      ) {
        return 0 as unknown as Data;
      }

      this.#cache.delete(cacheKey);
      return 1 as unknown as Data;
    }

    if (script.includes('bk:fixed-window:v1')) {
      const key = keys[0];
      const limit = args[0];
      const windowMs = args[1];
      const redisNow = this.now();

      if (
        !key ||
        typeof limit !== 'number' ||
        typeof windowMs !== 'number' ||
        !Number.isSafeInteger(redisNow + windowMs)
      ) {
        throw new Error('Malformed fixed-window fixture command');
      }

      const existing = this.#fixedWindows.get(key);
      const state =
        !existing || redisNow >= existing.resetAt
          ? { count: 1, resetAt: redisNow + windowMs }
          : { count: existing.count + 1, resetAt: existing.resetAt };
      this.#fixedWindows.set(key, state);
      const allowed = state.count <= limit;
      return [
        allowed ? 1 : 0,
        state.count,
        Math.max(0, limit - state.count),
        state.resetAt,
        allowed ? 0 : state.resetAt - redisNow,
        redisNow,
      ] as unknown as Data;
    }

    if (!script.includes('bk:fenced-cache-write:v1')) {
      throw new Error('Unsupported fake script');
    }

    const leaseKey = keys[0];
    const cacheKey = keys[1];
    const token = args[0];
    const serializedValue = args[1];
    const lease = leaseKey ? this.#leases.get(leaseKey) : undefined;

    if (
      !leaseKey ||
      !cacheKey ||
      typeof token !== 'string' ||
      typeof serializedValue !== 'string' ||
      !lease ||
      this.now() >= lease.expiresAt ||
      lease.token !== token
    ) {
      return 0 as unknown as Data;
    }

    this.#cache.set(cacheKey, JSON.parse(serializedValue));
    return 1 as unknown as Data;
  }

  #acquireBreaker(keys: string[], args: unknown[]): unknown[] {
    const key = keys[0];
    const candidateToken = args[0];
    const halfOpenLeaseMs = args[1];
    const stateRetentionMs = args[2];
    const redisNow = this.now();

    if (
      !key ||
      typeof candidateToken !== 'string' ||
      typeof halfOpenLeaseMs !== 'number' ||
      typeof stateRetentionMs !== 'number' ||
      !Number.isSafeInteger(redisNow + stateRetentionMs)
    ) {
      throw new Error('Malformed breaker-acquire fixture command');
    }

    const entry = this.#breakers.get(key);
    if (entry && redisNow >= entry.expiresAt) {
      this.#breakers.delete(key);
    }
    let state = redisNow < (entry?.expiresAt ?? 0) ? entry?.state : undefined;
    if (!state) {
      state = { phase: 'CLOSED', token: candidateToken, failures: 0, failureWindowEndsAt: null };
    }

    if (state.phase === 'CLOSED') {
      if (state.failureWindowEndsAt !== null && redisNow >= state.failureWindowEndsAt) {
        state = { phase: 'CLOSED', token: state.token, failures: 0, failureWindowEndsAt: null };
      }

      this.#breakers.set(key, { state, expiresAt: redisNow + stateRetentionMs });
      return [1, 'CLOSED', `bk-token:${state.token}`, 0, 0, redisNow];
    }

    if (state.phase === 'OPEN' && redisNow < state.openUntil) {
      this.#breakers.set(key, { state, expiresAt: redisNow + stateRetentionMs });
      return [0, 'OPEN', '', state.openUntil - redisNow, state.openUntil, redisNow];
    }

    if (state.phase === 'HALF_OPEN' && redisNow < state.leaseUntil) {
      this.#breakers.set(key, { state, expiresAt: redisNow + stateRetentionMs });
      return [0, 'HALF_OPEN', '', state.leaseUntil - redisNow, state.leaseUntil, redisNow];
    }

    const leaseUntil = redisNow + halfOpenLeaseMs;
    this.#breakers.set(key, {
      state: { phase: 'HALF_OPEN', token: candidateToken, leaseUntil },
      expiresAt: redisNow + stateRetentionMs,
    });
    return [1, 'HALF_OPEN', `bk-token:${candidateToken}`, 0, leaseUntil, redisNow];
  }

  #completeBreaker(keys: string[], args: unknown[]): number {
    const key = keys[0];
    const permitState = args[0];
    const permitToken = args[1];
    const outcome = args[2];
    const failureThreshold = args[3];
    const failureWindowMs = args[4];
    const cooldownMs = args[5];
    const stateRetentionMs = args[6];
    const redisNow = this.now();

    if (
      !key ||
      (permitState !== 'CLOSED' && permitState !== 'HALF_OPEN') ||
      typeof permitToken !== 'string' ||
      (outcome !== 'SUCCESS' && outcome !== 'FAILURE' && outcome !== 'NEUTRAL') ||
      typeof failureThreshold !== 'number' ||
      typeof failureWindowMs !== 'number' ||
      typeof cooldownMs !== 'number' ||
      typeof stateRetentionMs !== 'number' ||
      !Number.isSafeInteger(redisNow + stateRetentionMs)
    ) {
      throw new Error('Malformed breaker-complete fixture command');
    }

    const entry = this.#breakers.get(key);
    if (!entry || redisNow >= entry.expiresAt) {
      this.#breakers.delete(key);
      return 0;
    }
    let state = entry.state;

    if (permitState === 'CLOSED') {
      if (state.phase !== 'CLOSED' || state.token !== permitToken) {
        return 0;
      }

      if (state.failureWindowEndsAt !== null && redisNow >= state.failureWindowEndsAt) {
        state = { phase: 'CLOSED', token: state.token, failures: 0, failureWindowEndsAt: null };
      }

      if (outcome === 'NEUTRAL') {
        this.#breakers.set(key, { state, expiresAt: redisNow + stateRetentionMs });
        return 1;
      }

      if (outcome === 'SUCCESS') {
        state.failures = 0;
        state.failureWindowEndsAt = null;
        this.#breakers.set(key, { state, expiresAt: redisNow + stateRetentionMs });
        return 1;
      }

      if (state.failures === 0) {
        state.failureWindowEndsAt = redisNow + failureWindowMs;
      }
      state.failures += 1;
      if (state.failures >= failureThreshold) {
        state = { phase: 'OPEN', openUntil: redisNow + cooldownMs };
      }
      this.#breakers.set(key, { state, expiresAt: redisNow + stateRetentionMs });
      return 1;
    }

    if (state.phase !== 'HALF_OPEN' || state.token !== permitToken || redisNow >= state.leaseUntil) {
      return 0;
    }

    if (outcome === 'SUCCESS') {
      state = { phase: 'CLOSED', token: permitToken, failures: 0, failureWindowEndsAt: null };
      this.#breakers.set(key, { state, expiresAt: redisNow + stateRetentionMs });
      return 1;
    }

    state = { phase: 'OPEN', openUntil: outcome === 'FAILURE' ? redisNow + cooldownMs : redisNow };
    this.#breakers.set(key, { state, expiresAt: redisNow + stateRetentionMs });
    return 1;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Upstash fleet-state public boundary', () => {
  it('exports the injected adapter and explicit SDK client factory', async () => {
    const cacheModule = await import('../../../src/server/cache');

    expect(cacheModule).toMatchObject({
      UpstashFleetStateStore: expect.any(Function),
      createUpstashRedisClient: expect.any(Function),
    });
  });

  it('pins the approved server dependency exactly', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['@upstash/redis']).toBe('1.38.0');
  });
});

describe('createUpstashRedisClient', () => {
  it('uses explicit credentials, one timeout signal, zero retries, and disabled telemetry', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        throw new Error('offline fixture');
      }),
    );

    const client = createUpstashRedisClient({
      url: 'https://fixture.upstash.invalid',
      token: 'fixture-token',
      requestTimeoutMs: 10_000,
    });
    const store = new UpstashFleetStateStore(client);

    expect(client).toBeInstanceOf(Redis);
    await expect(store.readCache('fixture:key')).rejects.toThrow('offline fixture');
    expect(requests).toHaveLength(1);

    const request = requests[0];
    expect(request).toBeDefined();
    expect(request?.init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(request?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer fixture-token');
    expect([...headers.keys()].some((key) => key.toLowerCase().startsWith('upstash-telemetry-'))).toBe(false);
  });

  it.each([
    [{ url: '', token: 'token', requestTimeoutMs: 100 }, TypeError],
    [{ url: 'https://fixture.upstash.invalid', token: '', requestTimeoutMs: 100 }, TypeError],
    [{ url: 'https://fixture.upstash.invalid', token: 'token', requestTimeoutMs: 0 }, RangeError],
    [{ url: 'https://fixture.upstash.invalid', token: 'token', requestTimeoutMs: 1.5 }, RangeError],
    [{ url: 'https://fixture.upstash.invalid', token: 'token', requestTimeoutMs: Number.NaN }, RangeError],
  ])('rejects invalid explicit client options', (options, expectedError) => {
    expect(() => createUpstashRedisClient(options)).toThrow(expectedError);
  });
});

describe('UpstashFleetStateStore contract boundary', () => {
  it('implements every fleet-state operation through an injected command client', () => {
    const store = new UpstashFleetStateStore({} as UpstashCommandClient);

    expect(store).toMatchObject({
      readCache: expect.any(Function),
      writeCache: expect.any(Function),
      deleteCache: expect.any(Function),
      tryAcquireLease: expect.any(Function),
      releaseLease: expect.any(Function),
      writeCacheIfLeaseOwner: expect.any(Function),
      deleteCacheIfLeaseOwner: expect.any(Function),
      consumeFixedWindow: expect.any(Function),
      acquireBreaker: expect.any(Function),
      completeBreaker: expect.any(Function),
    });
  });
});

describe('UpstashFleetStateStore cache commands', () => {
  it('reads a cache value with GET and preserves a missing null', async () => {
    const value = { version: 1, kind: 'positive' };
    const client = new RecordingCommandClient([value, null]);
    const store = new UpstashFleetStateStore(client);

    await expect(store.readCache('cache:a')).resolves.toEqual(value);
    await expect(store.readCache('cache:missing')).resolves.toBeNull();
    expect(client.calls).toEqual([
      { command: 'get', key: 'cache:a' },
      { command: 'get', key: 'cache:missing' },
    ]);
  });

  it('writes a JSON cache value with SET PX and accepts only OK', async () => {
    const client = new RecordingCommandClient(['OK']);
    const store = new UpstashFleetStateStore(client);

    await expect(store.writeCache('cache:a', { z: 2, a: 1 }, 500)).resolves.toBeUndefined();
    expect(client.calls).toEqual([
      {
        command: 'set',
        key: 'cache:a',
        value: '{"a":1,"z":2}',
        options: { px: 500 },
      },
    ]);
  });

  it.each(['123', 'true', 'null'])(
    'round-trips JSON-looking cache string %j through SDK deserialization',
    async (value) => {
      const client = new LeaseAwareFakeClient(() => 1_000);
      const store = new UpstashFleetStateStore(client);

      await store.writeCache('cache:a', value, 500);
      await expect(store.readCache('cache:a')).resolves.toBe(value);
    },
  );

  it.each([null, 'NOPE', 1])('fails closed on malformed cache SET result %j', async (result) => {
    const client = new RecordingCommandClient([result]);
    const store = new UpstashFleetStateStore(client);
    await expect(store.writeCache('cache:a', {}, 100)).rejects.toThrow(TypeError);
  });

  it('maps DEL 0/1 and rejects every malformed deletion result', async () => {
    const client = new RecordingCommandClient([1, 0, 2]);
    const store = new UpstashFleetStateStore(client);

    await expect(store.deleteCache('cache:a')).resolves.toBe(true);
    await expect(store.deleteCache('cache:b')).resolves.toBe(false);
    await expect(store.deleteCache('cache:c')).rejects.toThrow(TypeError);
  });

  it('rejects invalid TTL and non-JSON values before issuing SET', async () => {
    const client = new RecordingCommandClient([]);
    const store = new UpstashFleetStateStore(client);

    await expect(store.writeCache('cache:a', {}, 0)).rejects.toThrow(RangeError);
    await expect(store.writeCache('cache:a', { invalid: undefined }, 100)).rejects.toThrow(TypeError);
    expect(client.calls).toEqual([]);
  });
});

describe('UpstashFleetStateStore lease commands', () => {
  it('acquires a lease with SET NX PX and maps OK/null', async () => {
    const client = new RecordingCommandClient(['OK', null]);
    const store = new UpstashFleetStateStore(client);

    await expect(store.tryAcquireLease('lease:a', 'owner-a', 100)).resolves.toBe(true);
    await expect(store.tryAcquireLease('lease:a', 'owner-b', 100)).resolves.toBe(false);
    expect(client.calls).toEqual([
      {
        command: 'set',
        key: 'lease:a',
        value: 'owner-a',
        options: { nx: true, px: 100 },
      },
      {
        command: 'set',
        key: 'lease:a',
        value: 'owner-b',
        options: { nx: true, px: 100 },
      },
    ]);
  });

  it('fails closed on malformed lease SET results', async () => {
    const client = new RecordingCommandClient(['unexpected']);
    const store = new UpstashFleetStateStore(client);
    await expect(store.tryAcquireLease('lease:a', 'owner-a', 100)).rejects.toThrow(TypeError);
  });

  it('releases with one compare-token-delete EVAL and maps 0/1', async () => {
    const client = new RecordingCommandClient([1, 0]);
    const store = new UpstashFleetStateStore(client);

    await expect(store.releaseLease('lease:a', 'owner-a')).resolves.toBe(true);
    await expect(store.releaseLease('lease:a', 'owner-old')).resolves.toBe(false);

    const calls = client.calls as Array<Extract<RecordedCommand, { command: 'eval' }>>;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.keys).toEqual(['lease:a']);
    expect(calls[0]?.args).toEqual(['owner-a']);
    expect(calls[0]?.script).toMatch(/^#!lua flags=allow-key-locking\n-- bk:release-lease:v1/);
    expect(calls[0]?.script).toContain('bk:release-lease:v1');
    expect(calls[0]?.script).toContain("redis.call('GET', KEYS[1])");
    expect(calls[0]?.script).toContain("redis.call('DEL', KEYS[1])");
  });

  it('rejects malformed release EVAL results', async () => {
    const client = new RecordingCommandClient(['1']);
    const store = new UpstashFleetStateStore(client);
    await expect(store.releaseLease('lease:a', 'owner-a')).rejects.toThrow(TypeError);
  });
});

describe('UpstashFleetStateStore fenced cache commit', () => {
  it('checks the owner token and writes cache with PX in one EVAL', async () => {
    const client = new RecordingCommandClient([1, 0]);
    const store = new UpstashFleetStateStore(client);

    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: 'owner-a',
        cacheKey: 'cache:a',
        value: { z: 2, a: 1 },
        ttlMs: 500,
      }),
    ).resolves.toBe(true);
    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: 'owner-old',
        cacheKey: 'cache:a',
        value: { stale: true },
        ttlMs: 500,
      }),
    ).resolves.toBe(false);

    const calls = client.calls as Array<Extract<RecordedCommand, { command: 'eval' }>>;
    expect(calls[0]?.keys).toEqual(['lease:a', 'cache:a']);
    expect(calls[0]?.args).toEqual(['owner-a', '{"a":1,"z":2}', 500]);
    expect(calls[0]?.script).toMatch(/^#!lua flags=allow-key-locking\n-- bk:fenced-cache-write:v1/);
    expect(calls[0]?.script).toContain('bk:fenced-cache-write:v1');
    expect(calls[0]?.script).toContain("redis.call('GET', KEYS[1])");
    expect(calls[0]?.script).toContain("redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])");
  });

  it('prevents A from overwriting B after A expires and B reacquires', async () => {
    let now = 1_000;
    const client = new LeaseAwareFakeClient(() => now);
    const store = new UpstashFleetStateStore(client);

    await store.tryAcquireLease('lease:a', 'owner-a', 100);
    now = 1_100;
    await store.tryAcquireLease('lease:a', 'owner-b', 100);
    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: 'owner-b',
        cacheKey: 'cache:a',
        value: { revision: 'new' },
        ttlMs: 500,
      }),
    ).resolves.toBe(true);
    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: 'owner-a',
        cacheKey: 'cache:a',
        value: { revision: 'late-old' },
        ttlMs: 500,
      }),
    ).resolves.toBe(false);
    await expect(store.readCache('cache:a')).resolves.toEqual({ revision: 'new' });
  });

  it('fails closed on malformed fenced-write result', async () => {
    const client = new RecordingCommandClient(['1']);
    const store = new UpstashFleetStateStore(client);
    await expect(
      store.writeCacheIfLeaseOwner({
        leaseKey: 'lease:a',
        leaseToken: 'owner-a',
        cacheKey: 'cache:a',
        value: {},
        ttlMs: 100,
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe('UpstashFleetStateStore fenced cache delete', () => {
  it('checks the owner token and deletes cache in one EVAL', async () => {
    const client = new RecordingCommandClient([1, 0]);
    const store = new UpstashFleetStateStore(client);

    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-a', cacheKey: 'cache:a' }),
    ).resolves.toBe(true);
    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-old', cacheKey: 'cache:a' }),
    ).resolves.toBe(false);

    const calls = client.calls as Array<Extract<RecordedCommand, { command: 'eval' }>>;
    expect(calls[0]?.keys).toEqual(['lease:a', 'cache:a']);
    expect(calls[0]?.args).toEqual(['owner-a']);
    expect(calls[0]?.script).toMatch(/^#!lua flags=allow-key-locking\n-- bk:fenced-cache-delete:v1/);
    expect(calls[0]?.script).toContain("redis.call('GET', KEYS[1])");
    expect(calls[0]?.script).toContain("redis.call('DEL', KEYS[2])");
  });

  it('prevents A from deleting B cache after A expires and B reacquires', async () => {
    let now = 1_000;
    const client = new LeaseAwareFakeClient(() => now);
    const store = new UpstashFleetStateStore(client);
    await store.tryAcquireLease('lease:a', 'owner-a', 100);
    now = 1_100;
    await store.tryAcquireLease('lease:a', 'owner-b', 100);
    await store.writeCacheIfLeaseOwner({
      leaseKey: 'lease:a',
      leaseToken: 'owner-b',
      cacheKey: 'cache:a',
      value: { revision: 'new' },
      ttlMs: 500,
    });

    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-a', cacheKey: 'cache:a' }),
    ).resolves.toBe(false);
    await expect(store.readCache('cache:a')).resolves.toEqual({ revision: 'new' });
    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-b', cacheKey: 'cache:a' }),
    ).resolves.toBe(true);
    await expect(store.readCache('cache:a')).resolves.toBeNull();
    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-b', cacheKey: 'cache:a' }),
    ).resolves.toBe(true);
  });

  it('fails closed on malformed result and rejects an invalid token before EVAL', async () => {
    const malformed = new UpstashFleetStateStore(new RecordingCommandClient(['1']));
    await expect(
      malformed.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: 'owner-a', cacheKey: 'cache:a' }),
    ).rejects.toThrow(TypeError);

    const client = new RecordingCommandClient([]);
    const store = new UpstashFleetStateStore(client);
    await expect(
      store.deleteCacheIfLeaseOwner({ leaseKey: 'lease:a', leaseToken: '', cacheKey: 'cache:a' }),
    ).rejects.toThrow(TypeError);
    expect(client.calls).toEqual([]);
  });
});

describe('UpstashFleetStateStore fixed-window EVAL', () => {
  it('uses Redis TIME and sends one script with the key, policy, and PX persistence', async () => {
    const client = new RecordingCommandClient([
      [1, 1, 1, 1_100, 0, 1_000],
      [0, 3, 0, 1_100, 100, 1_000],
    ]);
    const store = new UpstashFleetStateStore(client);
    const policy = { limit: 2, windowMs: 100 };

    await expect(store.consumeFixedWindow('rate:a', policy)).resolves.toEqual({
      allowed: true,
      count: 1,
      remaining: 1,
      resetAt: 1_100,
      retryAfterMs: 0,
    });
    await expect(store.consumeFixedWindow('rate:a', policy)).resolves.toEqual({
      allowed: false,
      count: 3,
      remaining: 0,
      resetAt: 1_100,
      retryAfterMs: 100,
    });

    const calls = client.calls as Array<Extract<RecordedCommand, { command: 'eval' }>>;
    expect(calls[0]?.keys).toEqual(['rate:a']);
    expect(calls[0]?.args).toEqual([2, 100]);
    expect(calls[0]?.script).toMatch(/^#!lua flags=allow-key-locking\n-- bk:fixed-window:v1/);
    expect(calls[0]?.script).toContain('bk:fixed-window:v1');
    expect(calls[0]?.script).toContain("redis.call('TIME')");
    expect(calls[0]?.script).toContain("redis.call('GET', KEYS[1])");
    expect(calls[0]?.script).toContain('pcall(cjson.decode, raw)');
    expect(calls[0]?.script).toContain('count < 1');
    expect(calls[0]?.script).toContain('windowMs > maxSafeInteger - now');
    expect(calls[0]?.script).toContain("redis.call('SET', KEYS[1], encoded, 'PX', ttl)");
  });

  it('shares one atomic window across two adapters and resets exactly at the boundary', async () => {
    let now = 1_000;
    const client = new LeaseAwareFakeClient(() => now);
    const firstStore = new UpstashFleetStateStore(client);
    const secondStore = new UpstashFleetStateStore(client);
    const policy = { limit: 1, windowMs: 100 };

    await expect(firstStore.consumeFixedWindow('rate:a', policy)).resolves.toMatchObject({
      allowed: true,
      count: 1,
      resetAt: 1_100,
    });
    await expect(secondStore.consumeFixedWindow('rate:a', policy)).resolves.toMatchObject({
      allowed: false,
      count: 2,
      retryAfterMs: 100,
    });
    now = 1_099;
    await expect(firstStore.consumeFixedWindow('rate:a', policy)).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 1,
    });
    now = 1_100;
    await expect(secondStore.consumeFixedWindow('rate:a', policy)).resolves.toEqual({
      allowed: true,
      count: 1,
      remaining: 0,
      resetAt: 1_200,
      retryAfterMs: 0,
    });
  });

  it.each([
    null,
    [1, 1, 0],
    [2, 1, 1, 1_100, 0, 1_000],
    [1, '1', 1, 1_100, 0, 1_000],
    [1, 1, 0, 1_000, 0, 1_000],
    [0, 3, 0, 1_100, 99, 1_000],
    [1, 1, 1, 1_100, 0, '1000'],
  ])('fails closed on malformed fixed-window result %j', async (result) => {
    const client = new RecordingCommandClient([result]);
    const store = new UpstashFleetStateStore(client);
    await expect(store.consumeFixedWindow('rate:a', { limit: 2, windowMs: 100 })).rejects.toThrow(TypeError);
  });

  it('rejects unsafe Redis-time window arithmetic before mutating the counter', async () => {
    let redisNow = Number.MAX_SAFE_INTEGER - 99;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const store = new UpstashFleetStateStore(client);

    await expect(store.consumeFixedWindow('rate:overflow', { limit: 1, windowMs: 100 })).rejects.toThrow();
    redisNow = 1_000;
    await expect(store.consumeFixedWindow('rate:overflow', { limit: 1, windowMs: 100 })).resolves.toMatchObject({
      allowed: true,
      count: 1,
    });
  });
});

describe('UpstashFleetStateStore breaker EVAL commands', () => {
  const policy: BreakerPolicy = {
    failureThreshold: 2,
    failureWindowMs: 200,
    cooldownMs: 100,
    halfOpenLeaseMs: 50,
    closedCompletionBoundMs: 100,
    stateRetentionMs: 500,
  };

  it('maps every acquire state from one Redis-TIME-backed EVAL', async () => {
    const client = new RecordingCommandClient([
      [1, 'CLOSED', 'bk-token:closed-cycle', 0, 0, 1_000],
      [0, 'OPEN', '', 100, 1_100, 1_000],
      [1, 'HALF_OPEN', 'bk-token:probe-a', 0, 1_150, 1_100],
      [0, 'HALF_OPEN', '', 50, 1_150, 1_100],
    ]);
    const store = new UpstashFleetStateStore(client);

    await expect(store.acquireBreaker('breaker:a', 'candidate-a', policy)).resolves.toEqual({
      allowed: true,
      state: 'CLOSED',
      token: 'closed-cycle',
    });
    await expect(store.acquireBreaker('breaker:a', 'candidate-b', policy)).resolves.toEqual({
      allowed: false,
      state: 'OPEN',
      retryAfterMs: 100,
    });
    await expect(store.acquireBreaker('breaker:a', 'probe-a', policy)).resolves.toEqual({
      allowed: true,
      state: 'HALF_OPEN',
      token: 'probe-a',
    });
    await expect(store.acquireBreaker('breaker:a', 'probe-b', policy)).resolves.toEqual({
      allowed: false,
      state: 'HALF_OPEN',
      retryAfterMs: 50,
    });

    const calls = client.calls as Array<Extract<RecordedCommand, { command: 'eval' }>>;
    expect(calls[0]?.keys).toEqual(['breaker:a']);
    expect(calls[0]?.args).toEqual(['candidate-a', 50, 500]);
    expect(calls[0]?.script).toMatch(/^#!lua flags=allow-key-locking\n-- bk:breaker-acquire:v1/);
    expect(calls[0]?.script).toContain('bk:breaker-acquire:v1');
    expect(calls[0]?.script).toContain("redis.call('TIME')");
    expect(calls[0]?.script).toContain("redis.call('GET', KEYS[1])");
    expect(calls[0]?.script).toContain("'bk-token:' .. state.token");
    expect(calls[0]?.script).toContain("'bk-token:' .. candidateToken");
    expect(calls[0]?.script).toContain('stateTtlMs > maxSafeInteger - now');
    expect(calls[0]?.script).toContain("redis.call('SET', KEYS[1], encoded, 'PX', stateTtlMs)");
  });

  it.each([
    null,
    [1, 'CLOSED'],
    [2, 'CLOSED', 'bk-token:token', 0, 0, 1_000],
    [1, 'OPEN', 'bk-token:token', 0, 0, 1_000],
    [1, 'CLOSED', '', 0, 0, 1_000],
    [1, 'HALF_OPEN', 'bk-token:probe', 0, 1_149, 1_100],
    [0, 'OPEN', '', 99, 1_100, 1_000],
    [0, 'HALF_OPEN', 'probe', 50, 1_150, 1_100],
    [0, 'HALF_OPEN', '', 0, 1_100, 1_100],
  ])('fails closed on malformed breaker-acquire result %j', async (result) => {
    const store = new UpstashFleetStateStore(new RecordingCommandClient([result]));
    await expect(store.acquireBreaker('breaker:a', 'candidate', policy)).rejects.toThrow(TypeError);
  });

  it.each(['123', 'true', 'null'])(
    'round-trips JSON-looking token %j without changing Redis state identity',
    async (token) => {
      const client = new RecordingCommandClient([[1, 'CLOSED', `bk-token:${token}`, 0, 0, 1_000]]);
      const store = new UpstashFleetStateStore(client);

      await expect(store.acquireBreaker('breaker:a', token, policy)).resolves.toEqual({
        allowed: true,
        state: 'CLOSED',
        token,
      });
      expect(client.calls[0]).toMatchObject({ command: 'eval', args: [token, 50, 500] });
    },
  );

  it('completes only the matching permit with one token-checked EVAL', async () => {
    const client = new RecordingCommandClient([1, 0]);
    const store = new UpstashFleetStateStore(client);
    const closed: AllowedBreakerPermit = { allowed: true, state: 'CLOSED', token: 'closed-cycle' };
    const halfOpen: AllowedBreakerPermit = { allowed: true, state: 'HALF_OPEN', token: 'probe-a' };

    await expect(store.completeBreaker('breaker:a', closed, 'FAILURE', policy)).resolves.toBe(true);
    await expect(store.completeBreaker('breaker:a', halfOpen, 'NEUTRAL', policy)).resolves.toBe(false);

    const calls = client.calls as Array<Extract<RecordedCommand, { command: 'eval' }>>;
    expect(calls[0]?.keys).toEqual(['breaker:a']);
    expect(calls[0]?.args).toEqual(['CLOSED', 'closed-cycle', 'FAILURE', 2, 200, 100, 500]);
    expect(calls[0]?.script).toMatch(/^#!lua flags=allow-key-locking\n-- bk:breaker-complete:v1/);
    expect(calls[0]?.script).toContain('bk:breaker-complete:v1');
    expect(calls[0]?.script).toContain("redis.call('TIME')");
    expect(calls[0]?.script).toContain("redis.call('GET', KEYS[1])");
    expect(calls[0]?.script).toContain("redis.call('SET', KEYS[1], encoded, 'PX', stateTtlMs)");
    expect(calls[0]?.script).toContain('stateTtlMs > maxSafeInteger - now');
    expect(calls[1]?.args).toEqual(['HALF_OPEN', 'probe-a', 'NEUTRAL', 2, 200, 100, 500]);
  });

  it('rejects malformed completion results, policies, tokens, and outcomes before trusting state', async () => {
    const malformedClient = new RecordingCommandClient(['1']);
    const malformedStore = new UpstashFleetStateStore(malformedClient);
    const permit: AllowedBreakerPermit = { allowed: true, state: 'CLOSED', token: 'closed-cycle' };
    await expect(malformedStore.completeBreaker('breaker:a', permit, 'SUCCESS', policy)).rejects.toThrow(TypeError);

    const client = new RecordingCommandClient([]);
    const store = new UpstashFleetStateStore(client);
    await expect(store.acquireBreaker('breaker:a', '', policy)).rejects.toThrow(TypeError);
    await expect(store.acquireBreaker('breaker:a', 'candidate', { ...policy, failureThreshold: 0 })).rejects.toThrow(
      RangeError,
    );
    await expect(
      store.acquireBreaker('breaker:a', 'candidate', { ...policy, closedCompletionBoundMs: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      store.acquireBreaker('breaker:a', 'candidate', { ...policy, stateRetentionMs: policy.failureWindowMs }),
    ).rejects.toThrow(RangeError);
    await expect(store.completeBreaker('breaker:a', permit, 'UNKNOWN' as BreakerOutcome, policy)).rejects.toThrow(
      TypeError,
    );
    expect(client.calls).toEqual([]);
  });
});

describe('UpstashFleetStateStore breaker fleet semantics', () => {
  const policy: BreakerPolicy = {
    failureThreshold: 2,
    failureWindowMs: 200,
    cooldownMs: 100,
    halfOpenLeaseMs: 50,
    closedCompletionBoundMs: 100,
    stateRetentionMs: 500,
  };

  const requireAllowed = async (
    store: UpstashFleetStateStore,
    key: string,
    candidateToken: string,
  ): Promise<AllowedBreakerPermit> => {
    const permit: BreakerPermit = await store.acquireBreaker(key, candidateToken, policy);
    expect(permit.allowed).toBe(true);

    if (!permit.allowed) {
      throw new Error('Expected an allowed breaker permit');
    }

    return permit;
  };

  const tripBreaker = async (store: UpstashFleetStateStore, key: string): Promise<void> => {
    const first = await requireAllowed(store, key, 'closed-a');
    await store.completeBreaker(key, first, 'FAILURE', policy);
    const second = await requireAllowed(store, key, 'closed-b');
    await store.completeBreaker(key, second, 'FAILURE', policy);
  };

  it('shares threshold and cooldown, then admits one HALF_OPEN probe exactly at the boundary', async () => {
    let redisNow = 1_000;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const firstStore = new UpstashFleetStateStore(client);
    const secondStore = new UpstashFleetStateStore(client);
    await tripBreaker(firstStore, 'breaker:a');

    await expect(secondStore.acquireBreaker('breaker:a', 'early', policy)).resolves.toEqual({
      allowed: false,
      state: 'OPEN',
      retryAfterMs: 100,
    });
    redisNow = 1_099;
    await expect(firstStore.acquireBreaker('breaker:a', 'early', policy)).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 1,
    });

    redisNow = 1_100;
    const permits = await Promise.all([
      firstStore.acquireBreaker('breaker:a', 'probe-a', policy),
      secondStore.acquireBreaker('breaker:a', 'probe-b', policy),
    ]);
    const probe = permits.find((permit) => permit.allowed);
    expect(permits.filter((permit) => permit.allowed)).toHaveLength(1);
    expect(permits.find((permit) => !permit.allowed)).toEqual({
      allowed: false,
      state: 'HALF_OPEN',
      retryAfterMs: 50,
    });
    if (!probe?.allowed) {
      throw new Error('Expected one half-open probe');
    }
    await expect(secondStore.completeBreaker('breaker:a', probe, 'SUCCESS', policy)).resolves.toBe(true);
    await expect(firstStore.acquireBreaker('breaker:a', 'closed-next', policy)).resolves.toMatchObject({
      allowed: true,
      state: 'CLOSED',
    });
  });

  it('reopens on HALF_OPEN failure and makes a neutral probe replaceable immediately', async () => {
    let redisNow = 1_000;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const store = new UpstashFleetStateStore(client);

    await tripBreaker(store, 'breaker:failure');
    redisNow = 1_100;
    const failedProbe = await requireAllowed(store, 'breaker:failure', 'probe-failed');
    await store.completeBreaker('breaker:failure', failedProbe, 'FAILURE', policy);
    await expect(store.acquireBreaker('breaker:failure', 'too-soon', policy)).resolves.toEqual({
      allowed: false,
      state: 'OPEN',
      retryAfterMs: 100,
    });

    redisNow = 2_000;
    await tripBreaker(store, 'breaker:neutral');
    redisNow = 2_100;
    const neutralProbe = await requireAllowed(store, 'breaker:neutral', 'probe-neutral');
    await store.completeBreaker('breaker:neutral', neutralProbe, 'NEUTRAL', policy);
    await expect(store.acquireBreaker('breaker:neutral', 'probe-replacement', policy)).resolves.toEqual({
      allowed: true,
      state: 'HALF_OPEN',
      token: 'probe-replacement',
    });
  });

  it('replaces an expired HALF_OPEN owner and rejects its late completion', async () => {
    let redisNow = 1_000;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const store = new UpstashFleetStateStore(client);
    await tripBreaker(store, 'breaker:a');
    redisNow = 1_100;
    const oldProbe = await requireAllowed(store, 'breaker:a', 'probe-old');

    redisNow = 1_149;
    await expect(store.acquireBreaker('breaker:a', 'probe-new', policy)).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 1,
    });
    redisNow = 1_150;
    const newProbe = await requireAllowed(store, 'breaker:a', 'probe-new');
    await expect(store.completeBreaker('breaker:a', oldProbe, 'SUCCESS', policy)).resolves.toBe(false);
    await expect(store.completeBreaker('breaker:a', newProbe, 'SUCCESS', policy)).resolves.toBe(true);
  });

  it('anchors the first failure at completion and resets exactly at the failure-window boundary', async () => {
    let redisNow = 1_000;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const store = new UpstashFleetStateStore(client);
    const slow = await requireAllowed(store, 'breaker:slow', 'slow-call');

    redisNow = 1_200;
    await store.completeBreaker('breaker:slow', slow, 'FAILURE', policy);
    const second = await requireAllowed(store, 'breaker:slow', 'second-call');
    await store.completeBreaker('breaker:slow', second, 'FAILURE', policy);
    await expect(store.acquireBreaker('breaker:slow', 'probe', policy)).resolves.toEqual({
      allowed: false,
      state: 'OPEN',
      retryAfterMs: 100,
    });

    redisNow = 2_000;
    const firstWindow = await requireAllowed(store, 'breaker:boundary', 'window-a');
    await store.completeBreaker('breaker:boundary', firstWindow, 'FAILURE', policy);
    redisNow = 2_200;
    const nextWindow = await requireAllowed(store, 'breaker:boundary', 'window-b');
    await store.completeBreaker('breaker:boundary', nextWindow, 'FAILURE', policy);
    await expect(store.acquireBreaker('breaker:boundary', 'still-closed', policy)).resolves.toMatchObject({
      allowed: true,
      state: 'CLOSED',
    });
  });

  it.each(['completion-first', 'acquire-first'] as const)(
    'counts an in-flight failure in the new window with %s boundary ordering',
    async (ordering) => {
      let redisNow = 1_000;
      const client = new LeaseAwareFakeClient(() => redisNow);
      const store = new UpstashFleetStateStore(client);
      const first = await requireAllowed(store, 'breaker:a', 'closed-cycle');
      await store.completeBreaker('breaker:a', first, 'FAILURE', policy);
      redisNow = 1_199;
      const inFlight = await requireAllowed(store, 'breaker:a', 'in-flight');
      redisNow = 1_200;

      if (ordering === 'acquire-first') {
        const boundaryPermit = await requireAllowed(store, 'breaker:a', 'boundary-acquire');
        expect(boundaryPermit.token).toBe(inFlight.token);
      }

      await expect(store.completeBreaker('breaker:a', inFlight, 'FAILURE', policy)).resolves.toBe(true);
      const thresholdFailure = await requireAllowed(store, 'breaker:a', 'threshold-failure');
      await store.completeBreaker('breaker:a', thresholdFailure, 'FAILURE', policy);
      await expect(store.acquireBreaker('breaker:a', 'probe', policy)).resolves.toEqual({
        allowed: false,
        state: 'OPEN',
        retryAfterMs: 100,
      });
    },
  );

  it('keeps a slow CLOSED completion through its bound and forgets state at retention', async () => {
    let redisNow = 1_000;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const store = new UpstashFleetStateStore(client);
    const slowPolicy: BreakerPolicy = {
      ...policy,
      closedCompletionBoundMs: 400,
      stateRetentionMs: 500,
    };
    const slowPermit = await store.acquireBreaker('breaker:slow', 'slow-cycle', slowPolicy);
    if (!slowPermit.allowed) {
      throw new Error('Expected a closed permit');
    }

    redisNow = 1_399;
    await expect(store.completeBreaker('breaker:slow', slowPermit, 'FAILURE', slowPolicy)).resolves.toBe(true);

    redisNow = 2_000;
    const retained = await requireAllowed(store, 'breaker:retention', 'retained-cycle');
    redisNow = 2_499;
    await expect(store.acquireBreaker('breaker:retention', 'before-expiry', policy)).resolves.toMatchObject({
      allowed: true,
      token: retained.token,
    });
    redisNow = 2_999;
    await expect(store.acquireBreaker('breaker:retention', 'after-refresh-boundary', policy)).resolves.toMatchObject({
      allowed: true,
      token: 'after-refresh-boundary',
    });
  });

  it('refreshes retention for a denied OPEN acquire', async () => {
    let redisNow = 1_000;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const store = new UpstashFleetStateStore(client);
    await tripBreaker(store, 'breaker:a');
    redisNow = 1_050;
    await expect(store.acquireBreaker('breaker:a', 'denied', policy)).resolves.toMatchObject({
      allowed: false,
      state: 'OPEN',
    });

    redisNow = 1_501;
    await expect(store.acquireBreaker('breaker:a', 'probe-after-original-retention', policy)).resolves.toMatchObject({
      allowed: true,
      state: 'HALF_OPEN',
    });
  });

  it('preserves OPEN and HALF_OPEN state at exact logical deadlines before retention', async () => {
    let redisNow = 1_000;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const firstStore = new UpstashFleetStateStore(client);
    const secondStore = new UpstashFleetStateStore(client);
    const longCooldownPolicy: BreakerPolicy = {
      failureThreshold: 1,
      failureWindowMs: 100,
      cooldownMs: 500,
      halfOpenLeaseMs: 50,
      closedCompletionBoundMs: 80,
      stateRetentionMs: 600,
    };
    const closed = await firstStore.acquireBreaker('breaker:open-boundary', 'closed', longCooldownPolicy);
    if (!closed.allowed) {
      throw new Error('Expected a closed permit');
    }
    await firstStore.completeBreaker('breaker:open-boundary', closed, 'FAILURE', longCooldownPolicy);
    redisNow = 1_500;
    const openBoundary = await Promise.all([
      firstStore.acquireBreaker('breaker:open-boundary', 'probe-a', longCooldownPolicy),
      secondStore.acquireBreaker('breaker:open-boundary', 'probe-b', longCooldownPolicy),
    ]);
    expect(openBoundary.filter((permit) => permit.allowed)).toHaveLength(1);
    expect(openBoundary.find((permit) => permit.allowed)).toMatchObject({ state: 'HALF_OPEN' });

    redisNow = 2_000;
    const longHalfOpenPolicy: BreakerPolicy = {
      failureThreshold: 1,
      failureWindowMs: 100,
      cooldownMs: 100,
      halfOpenLeaseMs: 500,
      closedCompletionBoundMs: 80,
      stateRetentionMs: 600,
    };
    const closedHalf = await firstStore.acquireBreaker('breaker:half-boundary', 'closed', longHalfOpenPolicy);
    if (!closedHalf.allowed) {
      throw new Error('Expected a closed permit');
    }
    await firstStore.completeBreaker('breaker:half-boundary', closedHalf, 'FAILURE', longHalfOpenPolicy);
    redisNow = 2_100;
    await firstStore.acquireBreaker('breaker:half-boundary', 'old-probe', longHalfOpenPolicy);
    redisNow = 2_600;
    const halfBoundary = await Promise.all([
      firstStore.acquireBreaker('breaker:half-boundary', 'replacement-a', longHalfOpenPolicy),
      secondStore.acquireBreaker('breaker:half-boundary', 'replacement-b', longHalfOpenPolicy),
    ]);
    expect(halfBoundary.filter((permit) => permit.allowed)).toHaveLength(1);
    expect(halfBoundary.find((permit) => permit.allowed)).toMatchObject({ state: 'HALF_OPEN' });
  });

  it('rejects unsafe Redis-time retention arithmetic before mutating breaker state', async () => {
    let redisNow = Number.MAX_SAFE_INTEGER - policy.stateRetentionMs + 1;
    const client = new LeaseAwareFakeClient(() => redisNow);
    const store = new UpstashFleetStateStore(client);

    await expect(store.acquireBreaker('breaker:overflow', 'unsafe-cycle', policy)).rejects.toThrow();
    redisNow = 1_000;
    await expect(store.acquireBreaker('breaker:overflow', 'safe-cycle', policy)).resolves.toEqual({
      allowed: true,
      state: 'CLOSED',
      token: 'safe-cycle',
    });
  });
});
