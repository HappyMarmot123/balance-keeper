// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(process.cwd());
const publicApiPath = resolve(projectRoot, 'src/features/theme-switch/index.ts');
const componentPath = resolve(projectRoot, 'src/features/theme-switch/ui/ThemeSwitch.tsx');

describe('theme-switch feature public API', () => {
  it('exports ThemeSwitch through its slice boundary', () => {
    expect(existsSync(publicApiPath), 'theme-switch public API is missing').toBe(true);
    expect(existsSync(componentPath), 'ThemeSwitch component is missing').toBe(true);

    if (!existsSync(publicApiPath) || !existsSync(componentPath)) {
      return;
    }

    expect(readFileSync(publicApiPath, 'utf8')).toContain("export { ThemeSwitch } from './ui/ThemeSwitch';");
  });
});
