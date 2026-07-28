// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('earthquake server boundary', () => {
  it('owns USGS and earthquake-route public entrypoints without another Vercel function', () => {
    expect(existsSync(resolve(process.cwd(), 'src/server/providers/usgs/index.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/earthquake/index.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'api/earthquake.ts'))).toBe(false);
  });
});
