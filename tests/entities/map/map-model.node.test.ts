// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { KOREA_MAP_VIEWPORT } from '../../../src/entities/map';

describe('KOREA_MAP_VIEWPORT', () => {
  it('defines one stable national overview within the provider-supported GL zoom range', () => {
    expect(KOREA_MAP_VIEWPORT).toEqual({
      center: { lat: 36.35, lng: 127.9 },
      zoom: 7,
      minZoom: 6,
      maxZoom: 20,
    });
  });
});
