// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('disaster widget public boundary', () => {
  it('exports only the product widget through its public entrypoint', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/widgets/disaster/index.ts'), 'utf8');

    expect(source).toContain("export { DisasterWidget } from './ui/DisasterWidget';");
    expect(source).not.toContain('DisasterView');
    expect(source).not.toContain('deriveNewDisasterAlertIds');
  });
});
