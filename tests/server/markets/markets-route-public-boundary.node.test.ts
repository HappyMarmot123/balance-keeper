// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('markets route public boundary', () => {
  it('keeps the route in the server graph behind one public entrypoint', () => {
    const route = resolve(process.cwd(), 'src/server/routes/markets/marketsRoute.ts');
    const publicApi = resolve(process.cwd(), 'src/server/routes/markets/index.ts');

    expect(existsSync(route)).toBe(true);
    expect(existsSync(publicApi)).toBe(true);
    if (!existsSync(route)) {
      return;
    }
    expect(readFileSync(route, 'utf8')).not.toMatch(/(?:widgets|@tanstack|preact)/);
  });
});
