// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const airQualityPublicApiPath = resolve(process.cwd(), 'src/entities/air-quality/index.ts');
const airQualityServerContractPath = resolve(process.cwd(), 'src/entities/air-quality/contract.ts');

describe('air-quality entity public boundary', () => {
  it('owns a public API entrypoint inside the air-quality entity slice', () => {
    expect(existsSync(airQualityPublicApiPath), 'src/entities/air-quality/index.ts must exist').toBe(true);
  });

  it('owns a server-safe contract entry without browser query dependencies', () => {
    expect(existsSync(airQualityServerContractPath), 'src/entities/air-quality/contract.ts must exist').toBe(true);
    if (!existsSync(airQualityServerContractPath)) {
      return;
    }

    const source = readFileSync(airQualityServerContractPath, 'utf8');
    expect(source).not.toMatch(/(?:@tanstack|shared\/api|airQualityQuery)/);
  });
});
