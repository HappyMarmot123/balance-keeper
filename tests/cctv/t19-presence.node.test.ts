// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const expectedFiles = [
  'src/entities/cctv/contract.ts',
  'src/entities/cctv/model/cctv.ts',
  'src/entities/cctv/api/cctvListQuery.ts',
  'src/entities/cctv/index.ts',
  'src/server/providers/its/cctvList.ts',
  'src/server/providers/its/index.ts',
  'src/server/routes/cctv/cctvListRoute.ts',
  'src/server/routes/cctv/index.ts',
] as const;

describe('T19 ITS CCTV metadata slice', () => {
  it('provides the approved entity, provider and route boundaries', () => {
    expect(expectedFiles.filter((path) => !existsSync(resolve(process.cwd(), path)))).toEqual([]);
  });
});
