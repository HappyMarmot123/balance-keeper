// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const publicApiPath = resolve(process.cwd(), 'src/entities/cctv/index.ts');
const serverContractPath = resolve(process.cwd(), 'src/entities/cctv/contract.ts');

describe('CCTV entity public boundary', () => {
  it('owns a slice public API and a server-safe contract without query dependencies', async () => {
    expect(existsSync(publicApiPath), 'src/entities/cctv/index.ts must exist').toBe(true);
    expect(existsSync(serverContractPath), 'src/entities/cctv/contract.ts must exist').toBe(true);
    if (!existsSync(serverContractPath)) {
      return;
    }

    const source = readFileSync(serverContractPath, 'utf8');
    expect(source).not.toMatch(/(?:@tanstack|shared\/api|cctvListQuery)/);

    const publicApi = await import('../../../src/entities/cctv');
    expect(publicApi).toEqual(
      expect.objectContaining({
        cctvDataSchema: expect.any(Object),
        cctvListQueryOptions: expect.any(Function),
        createCctvListPath: expect.any(Function),
      }),
    );
  });
});
