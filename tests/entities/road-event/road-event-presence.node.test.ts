// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('road event entity boundary', () => {
  it('publishes only the approved model, query and public contract files', () => {
    for (const path of [
      'src/entities/road-event/model/roadEvent.ts',
      'src/entities/road-event/api/roadEventQuery.ts',
      'src/entities/road-event/contract.ts',
      'src/entities/road-event/index.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
  });
});
