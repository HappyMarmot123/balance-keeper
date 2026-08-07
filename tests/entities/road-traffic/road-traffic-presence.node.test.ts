// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('road traffic entity boundary', () => {
  it('publishes the approved forecast, bounded-current and detector entity slices', () => {
    for (const path of [
      'src/entities/road-traffic/model/roadTrafficCurrent.ts',
      'src/entities/road-traffic/model/roadTrafficDetectors.ts',
      'src/entities/road-traffic/api/roadTrafficDetectorsQuery.ts',
      'src/entities/road-traffic/model/roadTrafficForecast.ts',
      'src/entities/road-traffic/api/roadTrafficCurrentQuery.ts',
      'src/entities/road-traffic/api/roadTrafficForecastQuery.ts',
      'src/entities/road-traffic/contract.ts',
      'src/entities/road-traffic/index.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
  });

  it('keeps a dedicated production-gateway live gate for the forecast slice', () => {
    const path = 'tests/server/road-traffic/road-traffic-forecast-live-smoke.node.test.ts';

    expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
  });

  it('fails an explicitly enabled forecast live gate when its credential is missing', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'tests/server/road-traffic/road-traffic-forecast-live-smoke.node.test.ts'),
      'utf8',
    );

    expect(source).toContain(
      "const liveIt = process.env.RUN_ITS_ROAD_TRAFFIC_FORECAST_LIVE_SMOKE === '1' ? it : it.skip;",
    );
  });
});
