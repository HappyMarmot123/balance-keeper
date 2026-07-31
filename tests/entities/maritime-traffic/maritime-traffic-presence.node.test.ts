// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contractPath = resolve('src/entities/maritime-traffic/contract.ts');
const publicApiPath = resolve('src/entities/maritime-traffic/index.ts');

describe('maritime traffic entity slice', () => {
  it('exposes a public API boundary', () => {
    expect(existsSync(publicApiPath)).toBe(true);
  });

  it('keeps the server contract free of browser query dependencies while exporting the query publicly', async () => {
    expect(existsSync(contractPath)).toBe(true);
    if (!existsSync(contractPath)) {
      return;
    }

    expect(readFileSync(contractPath, 'utf8')).not.toMatch(/(?:@tanstack|shared\/api|maritimeTrafficQuery)/);

    const publicApi = await import('../../../src/entities/maritime-traffic');
    expect(publicApi).toEqual(
      expect.objectContaining({
        maritimeTrafficDataSchema: expect.any(Object),
        maritimeTrafficQueryOptions: expect.any(Function),
      }),
    );
  });
});
