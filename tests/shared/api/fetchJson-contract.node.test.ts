// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(process.cwd());
const publicApiPath = resolve(projectRoot, 'src/shared/api/index.ts');
const fetchJsonPath = resolve(projectRoot, 'src/shared/api/fetchJson.ts');

describe('shared JSON transport public API', () => {
  it('exposes fetchJson through the shared/api public boundary', () => {
    expect(existsSync(fetchJsonPath), 'fetchJson transport is missing').toBe(true);

    if (!existsSync(fetchJsonPath)) {
      return;
    }

    const publicApi = readFileSync(publicApiPath, 'utf8');

    expect(publicApi).toContain("export { fetchJson } from './fetchJson';");
  });
});
