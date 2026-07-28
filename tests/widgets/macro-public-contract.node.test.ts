// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('macro widget public boundary', () => {
  it('exports only the product widget through its public entrypoint', () => {
    const entry = resolve(process.cwd(), 'src/widgets/macro/index.ts');

    expect(existsSync(entry)).toBe(true);
    expect(readFileSync(entry, 'utf8')).toContain("export { MacroWidget } from './ui/MacroWidget';");
  });
});
