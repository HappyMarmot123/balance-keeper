// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { roadTrafficCurrentDataSchema } from '../../../src/entities/road-traffic/contract';
import { fetchItsRoadTrafficCurrent } from '../../../src/server/providers/its';

const liveIt = process.env.RUN_ITS_ROAD_TRAFFIC_CURRENT_LIVE_SMOKE === '1' ? it : it.skip;

describe('ITS road traffic current explicit live smoke', () => {
  liveIt(
    'validates one bounded Seoul snapshot without retaining provider values',
    async () => {
      const serviceKey = process.env.ITS_API_KEY?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new Error('ITS road traffic current live smoke credential is missing');
      }
      const bounds = {
        maximumLatitude: 37.55,
        maximumLongitude: 127,
        minimumLatitude: 37.5,
        minimumLongitude: 126.95,
      } as const;
      const snapshot = await fetchItsRoadTrafficCurrent({
        bounds,
        fetcher: globalThis.fetch,
        serviceKey,
        signal: AbortSignal.timeout(12_000),
      });

      expect(roadTrafficCurrentDataSchema.parse(snapshot).bounds).toEqual(bounds);
      expect(snapshot.segments.length).toBeGreaterThan(0);
      expect(JSON.stringify(snapshot)).not.toContain(serviceKey);
    },
    15_000,
  );
});
