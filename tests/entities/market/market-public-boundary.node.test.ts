// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('market entity public boundary', () => {
  it('keeps the server-safe contract separate from browser query dependencies', () => {
    const publicApi = resolve(process.cwd(), 'src/entities/market/index.ts');
    const contract = resolve(process.cwd(), 'src/entities/market/contract.ts');

    expect(existsSync(publicApi)).toBe(true);
    expect(existsSync(contract)).toBe(true);
    if (!existsSync(contract)) {
      return;
    }
    expect(readFileSync(contract, 'utf8')).not.toMatch(/(?:@tanstack|shared\/api|marketsQuery)/);
  });
});
