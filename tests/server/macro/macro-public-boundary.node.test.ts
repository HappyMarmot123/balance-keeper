// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('macro server boundary', () => {
  it('uses the coarse gateway without creating another Vercel function', () => {
    expect(existsSync(resolve(process.cwd(), 'src/server/providers/ecos/index.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/macro/index.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'api/macro.ts'))).toBe(false);
  });
});
