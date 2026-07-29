// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('markets widget public boundary', () => {
  it('exports only the product widget through its public entrypoint', () => {
    const entry = resolve(process.cwd(), 'src/widgets/markets/index.ts');

    expect(existsSync(entry)).toBe(true);
    if (!existsSync(entry)) {
      return;
    }
    expect(readFileSync(entry, 'utf8')).toContain("export { MarketsWidget } from './ui/MarketsWidget';");
  });
});
