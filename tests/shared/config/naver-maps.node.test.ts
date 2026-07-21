// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { resolveNaverMapsConfig } from '../../../src/shared/config';

describe('resolveNaverMapsConfig', () => {
  it('requires the canonical browser key without exposing optional values', () => {
    const config = resolveNaverMapsConfig({
      VITE_NAVER_MAPS_KEY_ID: '   ',
      VITE_NAVER_MAP_STYLE_ID: 'style-that-must-not-leak',
    });

    expect(config).toEqual({ kind: 'missing-key' });
    expect(JSON.stringify(config)).not.toContain('style-that-must-not-leak');
  });

  it('normalizes the canonical key and optional style identifiers', () => {
    expect(
      resolveNaverMapsConfig({
        VITE_NAVER_MAPS_KEY_ID: '  browser-key  ',
        VITE_NAVER_MAP_STYLE_ID: '  published-style  ',
      }),
    ).toEqual({
      kind: 'ready',
      apiKeyId: 'browser-key',
      styleId: 'published-style',
    });
  });

  it('omits a blank optional style so the map can report its default-GL fallback', () => {
    expect(
      resolveNaverMapsConfig({
        VITE_NAVER_MAPS_KEY_ID: 'browser-key',
        VITE_NAVER_MAP_STYLE_ID: '   ',
      }),
    ).toEqual({
      kind: 'ready',
      apiKeyId: 'browser-key',
    });
  });

  it('does not accept a legacy alias as the canonical browser key', () => {
    expect(
      resolveNaverMapsConfig({
        VITE_NAVER_MAP_KEY_ID: 'legacy-alias',
      }),
    ).toEqual({ kind: 'missing-key' });
  });

  it.each([null, 42, true, {}, []])('treats a non-string key value as missing: %j', (value) => {
    expect(resolveNaverMapsConfig({ VITE_NAVER_MAPS_KEY_ID: value })).toEqual({ kind: 'missing-key' });
  });
});
