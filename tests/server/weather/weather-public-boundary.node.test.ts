import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

describe('weather server public boundary', () => {
  it('publishes one KMA provider boundary and one weather route boundary', () => {
    const requiredPublicApis = ['src/server/providers/kma/index.ts', 'src/server/routes/weather/index.ts'];
    const missingPublicApis = requiredPublicApis.filter(
      (relativePath) => !existsSync(resolve(workspaceRoot, relativePath)),
    );

    expect(missingPublicApis).toEqual([]);
  });
});
