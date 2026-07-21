// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('NAVER Maps type contract', () => {
  it('pins the official ambient types as a development-only dependency', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.devDependencies?.['@types/navermaps']).toBe('3.9.2');
    expect(packageJson.dependencies?.['@types/navermaps']).toBeUndefined();
  });

  it('loads the ambient namespace explicitly during type checking', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(process.cwd(), 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { types?: string[] };
    };

    expect(tsconfig.compilerOptions?.types).toContain('navermaps');
  });
});
