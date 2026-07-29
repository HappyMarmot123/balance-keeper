// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Financial Services Commission market provider boundary', () => {
  it('exists only in the server graph and does not expose credentials to the entity', () => {
    const provider = resolve(process.cwd(), 'src/server/providers/fsc/marketIndex.ts');
    const publicApi = resolve(process.cwd(), 'src/server/providers/fsc/index.ts');
    const entityContract = resolve(process.cwd(), 'src/entities/market/contract.ts');

    expect(existsSync(provider)).toBe(true);
    expect(existsSync(publicApi)).toBe(true);
    if (!existsSync(provider)) {
      return;
    }
    expect(readFileSync(provider, 'utf8')).not.toMatch(/VITE_/);
    expect(readFileSync(entityContract, 'utf8')).not.toMatch(/DATA_GO_KR_SERVICE_KEY|server\/providers/);
  });
});
