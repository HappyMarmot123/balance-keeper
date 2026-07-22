import { describe, expect, it } from 'vitest';
import { readFleetStateConfig } from '../../../src/server/runtime';

describe('fleet-state runtime configuration', () => {
  it('selects Upstash only when the credential pair is complete', () => {
    expect(
      readFleetStateConfig({
        UPSTASH_REDIS_REST_URL: '  https://example.upstash.io  ',
        UPSTASH_REDIS_REST_TOKEN: '  secret-token  ',
      }),
    ).toEqual({
      kind: 'upstash',
      url: 'https://example.upstash.io',
      token: 'secret-token',
      requestTimeoutMs: 2_500,
    });
  });

  it('keeps fleet state unavailable when both credentials are absent or blank', () => {
    expect(readFleetStateConfig({})).toEqual({ kind: 'unavailable' });
    expect(
      readFleetStateConfig({
        UPSTASH_REDIS_REST_URL: ' ',
        UPSTASH_REDIS_REST_TOKEN: '\t',
      }),
    ).toEqual({ kind: 'unavailable' });
  });

  it.each([{ UPSTASH_REDIS_REST_URL: 'https://example.upstash.io' }, { UPSTASH_REDIS_REST_TOKEN: 'secret-token' }])(
    'rejects a partial credential pair without exposing its value',
    (environment) => {
      let thrown: unknown;

      try {
        readFleetStateConfig(environment);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(TypeError);
      expect(String(thrown)).toContain('configured together');
      expect(String(thrown)).not.toContain(Object.values(environment)[0]);
    },
  );

  it.each(['0', '-1', '1.5', 'NaN', '0x10', '1e3', '+1200'])('rejects an invalid Upstash timeout: %s', (timeout) => {
    expect(() =>
      readFleetStateConfig({
        UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'secret-token',
        UPSTASH_REQUEST_TIMEOUT_MS: timeout,
      }),
    ).toThrow(RangeError);
  });

  it('accepts an explicit positive timeout', () => {
    expect(
      readFleetStateConfig({
        UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'secret-token',
        UPSTASH_REQUEST_TIMEOUT_MS: '1200',
      }),
    ).toMatchObject({ requestTimeoutMs: 1_200 });
  });

  it.each([
    'http://example.upstash.io',
    'https://user@example.upstash.io',
    'https://example.upstash.io/cache',
    'https://example.upstash.io?token=leak',
    'not-a-url',
  ])('rejects an unsafe Upstash REST URL without echoing it: %s', (url) => {
    let thrown: unknown;

    try {
      readFleetStateConfig({
        UPSTASH_REDIS_REST_TOKEN: 'secret-token',
        UPSTASH_REDIS_REST_URL: url,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).toContain('valid HTTPS origin');
    expect(String(thrown)).not.toContain(url);
  });
});
