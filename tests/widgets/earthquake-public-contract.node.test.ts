// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('earthquake widget public boundary', () => {
  it('owns one public widget entrypoint', () => {
    expect(existsSync(resolve(process.cwd(), 'src/widgets/earthquake/index.ts'))).toBe(true);
  });
});
