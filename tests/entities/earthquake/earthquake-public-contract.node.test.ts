// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicApiPath = resolve(process.cwd(), 'src/entities/earthquake/index.ts');
const serverContractPath = resolve(process.cwd(), 'src/entities/earthquake/contract.ts');

describe('earthquake entity public boundary', () => {
  it('owns a public API entrypoint inside the earthquake entity slice', () => {
    expect(existsSync(publicApiPath), 'src/entities/earthquake/index.ts must exist').toBe(true);
  });

  it('owns a server-safe contract without browser query dependencies', () => {
    expect(existsSync(serverContractPath), 'src/entities/earthquake/contract.ts must exist').toBe(true);
    if (!existsSync(serverContractPath)) {
      return;
    }

    const source = readFileSync(serverContractPath, 'utf8');
    expect(source).not.toMatch(/(?:@tanstack|shared\/api|earthquakeQuery)/);
  });
});
