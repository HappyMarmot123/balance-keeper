// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('road guidance entity boundary', () => {
  it('publishes the approved model, query and server-safe contract files', () => {
    for (const path of [
      'src/entities/road-guidance/model/roadGuidance.ts',
      'src/entities/road-guidance/api/roadGuidanceQuery.ts',
      'src/entities/road-guidance/contract.ts',
      'src/entities/road-guidance/index.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
  });
});
