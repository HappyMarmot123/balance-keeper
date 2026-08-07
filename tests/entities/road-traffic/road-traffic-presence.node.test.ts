// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('road traffic entity boundary', () => {
  it('publishes the approved forecast and bounded-current entity slice', () => {
    for (const path of [
      'src/entities/road-traffic/model/roadTrafficCurrent.ts',
      'src/entities/road-traffic/model/roadTrafficForecast.ts',
      'src/entities/road-traffic/api/roadTrafficCurrentQuery.ts',
      'src/entities/road-traffic/api/roadTrafficForecastQuery.ts',
      'src/entities/road-traffic/contract.ts',
      'src/entities/road-traffic/index.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
  });
});
