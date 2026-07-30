// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  CCTV_KOREA_BOUNDS,
  CCTV_MAX_BBOX_SPAN_DEGREES,
  cctvBoundsSchema,
  cctvDataSchema,
} from '../../../src/entities/cctv/contract';

const liveMediaUrl = `https://cctvsec.ktict.co.kr/4003/${'A'.repeat(107)}=`;
const stillMediaUrl = `https://cctvsec.ktict.co.kr:8091/4003/${'B'.repeat(86)}==`;

const normalizedSnapshot = {
  bounds: {
    maximumLatitude: 38,
    maximumLongitude: 127.5,
    minimumLatitude: 37,
    minimumLongitude: 126.5,
  },
  cameras: [
    {
      id: 'its-cctv:AbCdEfGhIjKlMnOp',
      latitude: 37.5,
      longitude: 127,
      media: {
        liveHls: {
          createdAt: null,
          resolution: null,
          url: liveMediaUrl,
        },
        stillImage: {
          createdAt: null,
          resolution: null,
          url: stillMediaUrl,
        },
      },
      name: '서울 국도 CCTV',
      roadSectionId: null,
      roadType: 'national-road',
    },
  ],
};

describe('CCTV entity contract', () => {
  it('accepts one normalized HTTPS metadata snapshot', () => {
    const schema = cctvDataSchema as z.ZodType;
    expect(schema.parse(normalizedSnapshot)).toEqual(normalizedSnapshot);

    const shortExpresswayVariant = structuredClone(normalizedSnapshot);
    const camera = shortExpresswayVariant.cameras[0];
    if (camera === undefined) {
      throw new TypeError('Expected a CCTV fixture camera');
    }
    camera.media.liveHls.url = `https://cctvsec.ktict.co.kr/1/${'C'.repeat(86)}==`;
    camera.media.stillImage.url = `https://cctvsec.ktict.co.kr:8091/1/${'D'.repeat(86)}==`;
    expect(schema.safeParse(shortExpresswayVariant).success).toBe(true);
  });

  it('keeps public media metadata on the probed HTTPS hosts and ports', () => {
    const httpStill = structuredClone(normalizedSnapshot);
    const httpStillCamera = httpStill.cameras[0];
    if (httpStillCamera === undefined) {
      throw new TypeError('Expected a CCTV fixture camera');
    }
    httpStillCamera.media.stillImage.url = stillMediaUrl.replace('https://', 'http://').replace(':8091', ':8090');
    expect(cctvDataSchema.safeParse(httpStill).success).toBe(false);

    const wrongStillPort = structuredClone(normalizedSnapshot);
    const wrongStillPortCamera = wrongStillPort.cameras[0];
    if (wrongStillPortCamera === undefined) {
      throw new TypeError('Expected a CCTV fixture camera');
    }
    wrongStillPortCamera.media.stillImage.url = stillMediaUrl.replace(':8091', '');
    expect(cctvDataSchema.safeParse(wrongStillPort).success).toBe(false);

    const wrongLiveHost = structuredClone(normalizedSnapshot);
    const wrongLiveHostCamera = wrongLiveHost.cameras[0];
    if (wrongLiveHostCamera === undefined) {
      throw new TypeError('Expected a CCTV fixture camera');
    }
    wrongLiveHostCamera.media.liveHls.url = liveMediaUrl.replace('cctvsec.ktict.co.kr', 'example.com');
    expect(cctvDataSchema.safeParse(wrongLiveHost).success).toBe(false);

    const credentialQuery = structuredClone(normalizedSnapshot);
    const credentialQueryCamera = credentialQuery.cameras[0];
    if (credentialQueryCamera === undefined) {
      throw new TypeError('Expected a CCTV fixture camera');
    }
    credentialQueryCamera.media.liveHls.url = `${liveMediaUrl}?token=secret`;
    expect(cctvDataSchema.safeParse(credentialQuery).success).toBe(false);
  });

  it('rejects unsafe media paths and merged snapshots above the public payload budget', () => {
    for (const unsafePath of [
      '/%2e%2e/private',
      '/%252e%252e/private',
      '/safe/%2fprivate',
      '/safe\\private',
      '//private',
      '/arbitrary/admin',
    ]) {
      const unsafe = structuredClone(normalizedSnapshot);
      const camera = unsafe.cameras[0];
      if (camera === undefined) {
        throw new TypeError('Expected a CCTV fixture camera');
      }
      camera.media.liveHls.url = `https://cctvsec.ktict.co.kr${unsafePath}`;
      expect(cctvDataSchema.safeParse(unsafe).success).toBe(false);
    }

    const oversized = {
      ...structuredClone(normalizedSnapshot),
      cameras: Array.from({ length: 2_000 }, (_, index) => ({
        ...structuredClone(normalizedSnapshot.cameras[0]),
        id: `its-cctv:${String(index).padStart(16, '0')}`,
        media: {
          liveHls: {
            createdAt: null,
            resolution: '가'.repeat(100),
            url: liveMediaUrl,
          },
          stillImage: {
            createdAt: null,
            resolution: '나'.repeat(100),
            url: stillMediaUrl,
          },
        },
        name: '다'.repeat(160),
        roadSectionId: '라'.repeat(200),
      })),
    };

    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(3 * 1_024 * 1_024);
    expect(cctvDataSchema.safeParse(oversized).success).toBe(false);
  });

  it('accepts only ordered Korea bounds no wider than one degree per axis', () => {
    expect(CCTV_KOREA_BOUNDS).toEqual({
      maximumLatitude: 39,
      maximumLongitude: 132,
      minimumLatitude: 33,
      minimumLongitude: 124,
    });
    expect(CCTV_MAX_BBOX_SPAN_DEGREES).toBe(1);

    expect(
      cctvBoundsSchema.safeParse({
        maximumLatitude: 38,
        maximumLongitude: 127.5,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
      }).success,
    ).toBe(true);
    expect(
      cctvBoundsSchema.safeParse({
        maximumLatitude: 38.0001,
        maximumLongitude: 127.5,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
      }).success,
    ).toBe(false);
    expect(
      cctvBoundsSchema.safeParse({
        maximumLatitude: 37,
        maximumLongitude: 127,
        minimumLatitude: 37,
        minimumLongitude: 126.5,
      }).success,
    ).toBe(false);
    expect(
      cctvBoundsSchema.safeParse({
        maximumLatitude: 38,
        maximumLongitude: 127,
        minimumLatitude: 32.9999,
        minimumLongitude: 126.5,
      }).success,
    ).toBe(false);
  });

  it('rejects cameras outside their requested bounds and duplicate IDs', () => {
    const outside = structuredClone(normalizedSnapshot);
    const outsideCamera = outside.cameras[0];
    if (outsideCamera === undefined) {
      throw new TypeError('Expected a CCTV fixture camera');
    }
    outsideCamera.longitude = 127.5001;
    expect(cctvDataSchema.safeParse(outside).success).toBe(false);

    const duplicate = structuredClone(normalizedSnapshot);
    const duplicateCamera = duplicate.cameras[0];
    if (duplicateCamera === undefined) {
      throw new TypeError('Expected a CCTV fixture camera');
    }
    duplicate.cameras.push(structuredClone(duplicateCamera));
    expect(cctvDataSchema.safeParse(duplicate).success).toBe(false);
  });

  it('requires deterministic expressway-first camera ordering', () => {
    const unordered = structuredClone(normalizedSnapshot);
    const nationalRoadCamera = unordered.cameras[0];
    if (nationalRoadCamera === undefined) {
      throw new TypeError('Expected a CCTV fixture camera');
    }
    unordered.cameras = [
      nationalRoadCamera,
      {
        ...structuredClone(nationalRoadCamera),
        id: 'its-cctv:QbCdEfGhIjKlMnOp',
        name: '서울 고속도로 CCTV',
        roadSectionId: null,
        roadType: 'expressway',
      },
    ];

    expect(cctvDataSchema.safeParse(unordered).success).toBe(false);
    expect(cctvDataSchema.safeParse({ ...unordered, cameras: [...unordered.cameras].reverse() }).success).toBe(true);
  });
});
