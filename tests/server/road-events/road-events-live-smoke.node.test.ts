// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { roadEventDataSchema } from '../../../src/entities/road-event/contract';
import { fetchItsRoadDisasters, fetchItsRoadIncidents } from '../../../src/server/providers/its';

const liveIt = process.env.RUN_ITS_ROAD_EVENTS_LIVE_SMOKE === '1' ? it : it.skip;

describe('ITS road events explicit live smoke', () => {
  liveIt(
    'validates the current incidents and disasters without retaining provider values',
    async () => {
      const serviceKey = process.env.ITS_API_KEY?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new Error('ITS road events live smoke credential is missing');
      }
      const now = Date.now();
      const incidents = await fetchItsRoadIncidents({
        fetcher: globalThis.fetch,
        now,
        serviceKey,
        signal: AbortSignal.timeout(12_000),
      });
      const disasters = await fetchItsRoadDisasters({
        fetcher: globalThis.fetch,
        now,
        serviceKey,
        signal: AbortSignal.timeout(12_000),
      });

      expect(roadEventDataSchema.parse(incidents)).toMatchObject({ channel: 'incidents', generatedAt: now });
      expect(roadEventDataSchema.parse(disasters)).toMatchObject({ channel: 'disasters', generatedAt: now });
      expect(JSON.stringify([incidents, disasters])).not.toContain(serviceKey);
    },
    20_000,
  );
});
