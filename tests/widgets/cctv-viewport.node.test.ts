// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { resolveCctvBounds } from '../../src/widgets/korea-map/model/cctvViewport';

describe('CCTV map viewport policy', () => {
  it('accepts the exact one-degree provider boundary and rejects the smallest canonical excess', () => {
    expect(
      resolveCctvBounds({
        maximumLatitude: 38,
        maximumLongitude: 127.5,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
        zoom: 10,
      }),
    ).toEqual({
      maximumLatitude: 38,
      maximumLongitude: 127.5,
      minimumLatitude: 37,
      minimumLongitude: 126.5,
    });

    expect(
      resolveCctvBounds({
        maximumLatitude: 38.0001,
        maximumLongitude: 127.5,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
        zoom: 10,
      }),
    ).toBeUndefined();
  });

  it('rejects out-of-Korea and rounding-collapsed viewports without inventing a bbox', () => {
    expect(
      resolveCctvBounds({
        maximumLatitude: 33.9,
        maximumLongitude: 124,
        minimumLatitude: 33.4,
        minimumLongitude: 123.5,
        zoom: 12,
      }),
    ).toBeUndefined();

    expect(
      resolveCctvBounds({
        maximumLatitude: 37.50002,
        maximumLongitude: 127.00002,
        minimumLatitude: 37.50001,
        minimumLongitude: 127.00001,
        zoom: 18,
      }),
    ).toBeUndefined();
  });
});
