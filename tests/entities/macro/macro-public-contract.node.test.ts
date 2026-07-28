// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('macro entity public boundary', () => {
  it('keeps the server-safe contract separate from browser query dependencies', () => {
    const publicApi = resolve(process.cwd(), 'src/entities/macro/index.ts');
    const contract = resolve(process.cwd(), 'src/entities/macro/contract.ts');

    expect(existsSync(publicApi)).toBe(true);
    expect(existsSync(contract)).toBe(true);
    expect(readFileSync(contract, 'utf8')).not.toMatch(/(?:@tanstack|shared\/api|macroQuery)/);
  });
});
