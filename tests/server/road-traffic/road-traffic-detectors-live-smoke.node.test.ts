// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS,
  ROAD_TRAFFIC_DETECTOR_MAX_SERIALIZED_BYTES,
  roadTrafficDetectorDataSchema,
} from '../../../src/entities/road-traffic/contract';
import { fetchItsRoadTrafficDetectors } from '../../../src/server/providers/its';

const liveIt = process.env.RUN_ITS_ROAD_TRAFFIC_DETECTORS_LIVE_SMOKE === '1' ? it : it.skip;

describe('ITS road traffic detector explicit live smoke', () => {
  liveIt(
    'validates one complete nationwide snapshot without retaining provider values',
    async () => {
      const serviceKey = process.env.ITS_API_KEY?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new Error('ITS road traffic detector live smoke credential is missing');
      }
      const snapshot = await fetchItsRoadTrafficDetectors({
        fetcher: globalThis.fetch,
        now: Date.now(),
        serviceKey,
        signal: AbortSignal.timeout(20_000),
      });
      const parsed = roadTrafficDetectorDataSchema.parse(snapshot);
      const observationCount = parsed.detectors.reduce((sum, detector) => sum + detector.observations.length, 0);
      expect(parsed.detectors.length).toBeGreaterThan(0);
      expect(observationCount).toBeGreaterThan(0);
      expect(observationCount).toBeLessThanOrEqual(ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS);
      const serialized = JSON.stringify(parsed);
      expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
        ROAD_TRAFFIC_DETECTOR_MAX_SERIALIZED_BYTES,
      );
      expect(serialized).not.toContain(serviceKey);
    },
    25_000,
  );
});
