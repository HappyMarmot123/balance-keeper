// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const expectedFiles = [
  'src/widgets/regional-context/ui/RegionalContextView.tsx',
  'src/widgets/regional-context/ui/RegionalContextWidget.tsx',
  'src/widgets/regional-context/index.ts',
] as const;

describe('T17 regional context vertical slice', () => {
  it('provides one public widget boundary without a neighbor API route', () => {
    expect(expectedFiles.filter((path) => !existsSync(resolve(projectRoot, path)))).toEqual([]);
    expect(existsSync(resolve(projectRoot, 'api/neighbor.ts'))).toBe(false);
    expect(existsSync(resolve(projectRoot, 'src/server/routes/neighbor'))).toBe(false);
  });

  it('exports only the regional context widget through its public API', () => {
    const publicApiPath = resolve(projectRoot, 'src/widgets/regional-context/index.ts');

    if (!existsSync(publicApiPath)) {
      expect.fail('regional context public API is missing');
    }

    expect(readFileSync(publicApiPath, 'utf8').trim()).toBe(
      "export { RegionalContextWidget } from './ui/RegionalContextWidget';",
    );
  });
});
