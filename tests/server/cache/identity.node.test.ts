// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createCacheKey, createStateKey, createWeakEtag } from '../../../src/server/cache';

describe('createCacheKey', () => {
  it('hashes the canonical public identity with SHA-256 base64url', () => {
    expect(createCacheKey('weather', { b: 2, a: 1 })).toBe(
      'bk:v1:cache:weather:QyWM_3g_5wNtikMDP4MK38YOwDc4JHNUisdCuIgpJ3c',
    );
  });

  it('is independent of plain-object insertion order and sensitive to array order', () => {
    expect(createCacheKey('cctv-list', { region: 'seoul', types: ['ex', 'its'] })).toBe(
      createCacheKey('cctv-list', { types: ['ex', 'its'], region: 'seoul' }),
    );
    expect(createCacheKey('cctv-list', { types: ['ex', 'its'] })).not.toBe(
      createCacheKey('cctv-list', { types: ['its', 'ex'] }),
    );
  });

  it('does not expose raw public identity values in the key', () => {
    const key = createCacheKey('news', { query: 'raw-query-marker', region: 'private-region-marker' });

    expect(key).toMatch(/^bk:v1:cache:news:[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain('raw-query-marker');
    expect(key).not.toContain('private-region-marker');
  });

  it.each(['', 'Weather', 'weather/current', 'weather:current', 'weather_current', ' weather', 'a'.repeat(65)])(
    'rejects unsafe route id %j',
    (routeId) => {
      expect(() => createCacheKey(routeId, {})).toThrow(TypeError);
    },
  );
});

describe('createWeakEtag', () => {
  const representation = {
    data: { a: 1 },
    source: 'fixture',
    fetchedAt: 1_000,
    kind: 'value' as const,
    degraded: false,
  };

  it('creates the versioned canonical SHA-256 weak validator', () => {
    expect(createWeakEtag(representation)).toBe('W/"bk1-nrOo4Yrx8HDsbqvUFX3-8_bqyyLPXZBQdblVs3D_fOU"');
  });

  it('is independent of nested object insertion order', () => {
    expect(createWeakEtag({ ...representation, data: { b: 2, a: 1 } })).toBe(
      createWeakEtag({ ...representation, data: { a: 1, b: 2 } }),
    );
  });

  it.each([
    ['data', { ...representation, data: { a: 2 } }],
    ['source', { ...representation, source: 'other-fixture' }],
    ['fetchedAt', { ...representation, fetchedAt: 1_001 }],
    ['kind', { ...representation, kind: 'empty' as const }],
    ['degraded', { ...representation, degraded: true }],
  ])('changes when %s changes', (_field, changed) => {
    expect(createWeakEtag(changed)).not.toBe(createWeakEtag(representation));
  });

  it('ignores request-local id and MISS/HIT provenance', () => {
    const withRequestMetadata = {
      ...representation,
      requestId: 'request-a',
      cache: 'MISS',
    };
    const withOtherRequestMetadata = {
      ...withRequestMetadata,
      requestId: 'request-b',
      cache: 'HIT',
    };

    expect(createWeakEtag(withRequestMetadata)).toBe(createWeakEtag(withOtherRequestMetadata));
  });
});

describe('createStateKey public boundary', () => {
  it('exports the coordination-key factory', async () => {
    const cacheModule = await import('../../../src/server/cache');
    expect(cacheModule).toHaveProperty('createStateKey', expect.any(Function));
  });
});

describe('createStateKey', () => {
  it('separates coordination kinds from cache keys and hashes variable identity', () => {
    const identity = { subject: 'raw-subject-marker' };
    const leaseKey = createStateKey('lease', 'route.weather', identity);

    expect(leaseKey).toMatch(/^bk:v1:state:lease:route\.weather:[A-Za-z0-9_-]{43}$/);
    expect(leaseKey).not.toBe(createCacheKey('weather', identity));
    expect(leaseKey).not.toContain('raw-subject-marker');
    expect(createStateKey('rate', 'route.weather', identity)).not.toBe(leaseKey);
    expect(createStateKey('breaker', 'provider.kma-weather', identity)).not.toBe(leaseKey);
  });

  it('uses a deterministic identity when the optional identity is absent', () => {
    expect(createStateKey('breaker', 'provider.kma-weather')).toBe(createStateKey('breaker', 'provider.kma-weather'));
  });

  it('accepts a namespaced dotted scope up to 96 characters', () => {
    expect(createStateKey('rate', `route.${'a'.repeat(90)}`, null)).toMatch(
      /^bk:v1:state:rate:route\.a+:[A-Za-z0-9_-]{43}$/,
    );
  });

  it.each([
    '',
    'weather',
    'Route.weather',
    'route/weather',
    'route:weather',
    'route_weather',
    ' route.weather',
    `route.${'a'.repeat(91)}`,
  ])('rejects unsafe state scope %j', (scope) => {
    expect(() => createStateKey('rate', scope, null)).toThrow(TypeError);
  });

  it('rejects an unknown coordination kind at runtime', () => {
    expect(() => createStateKey('counter' as 'rate', 'route.weather', null)).toThrow(TypeError);
  });
});
