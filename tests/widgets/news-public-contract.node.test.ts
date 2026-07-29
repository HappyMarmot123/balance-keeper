// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('news widget public boundary', () => {
  it('exports only the product widget through its public entrypoint', () => {
    const entry = resolve(process.cwd(), 'src/widgets/news/index.ts');

    expect(existsSync(entry)).toBe(true);
    if (!existsSync(entry)) {
      return;
    }
    const source = readFileSync(entry, 'utf8');
    expect(source).toContain("export { NewsWidget } from './ui/NewsWidget';");
    expect(source).not.toContain('NewsView');
  });
});
