// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  safetyNoticeSnapshotSchema,
  variableSpeedLimitSnapshotSchema,
  vmsGuidanceSnapshotSchema,
} from '../../../src/entities/road-guidance/contract';
import {
  fetchItsSafetyNotices,
  fetchItsVariableSpeedLimits,
  fetchItsVmsGuidance,
} from '../../../src/server/providers/its/roadGuidance';

const liveRequested = process.env.RUN_ITS_ROAD_GUIDANCE_LIVE_SMOKE === '1';
const liveIt = liveRequested ? it : it.skip;

describe('ITS road guidance explicit live smoke', () => {
  liveIt(
    'fetches and validates each production channel exactly once without retaining provider values',
    async () => {
      const serviceKey = process.env.ITS_API_KEY?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new Error('ITS road guidance live smoke credential is missing');
      }
      const now = Date.now();
      const createOptions = () => ({
        fetcher: globalThis.fetch,
        now,
        serviceKey,
        signal: AbortSignal.timeout(15_000),
      });

      const [vms, safetyNotices, variableSpeedLimits] = await Promise.all([
        fetchItsVmsGuidance(createOptions()),
        fetchItsSafetyNotices(createOptions()),
        fetchItsVariableSpeedLimits(createOptions()),
      ]);

      expect(vmsGuidanceSnapshotSchema.safeParse(vms).success).toBe(true);
      expect(safetyNoticeSnapshotSchema.safeParse(safetyNotices).success).toBe(true);
      expect(variableSpeedLimitSnapshotSchema.safeParse(variableSpeedLimits).success).toBe(true);
      expect(vms.channel).toBe('vms');
      expect(safetyNotices.channel).toBe('safety-notices');
      expect(variableSpeedLimits.channel).toBe('variable-speed-limits');
      expect(vms.items.length).toBeGreaterThan(0);
      expect(safetyNotices.items.length).toBeGreaterThan(0);
      expect(variableSpeedLimits.items.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
