// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(process.cwd());
const publicApiPath = resolve(projectRoot, 'src/shared/model/index.ts');
const themeModelPath = resolve(projectRoot, 'src/shared/model/theme.ts');

describe('shared theme model public API', () => {
  it('exposes an environment-independent model contract', () => {
    expect(existsSync(publicApiPath), 'shared/model public API is missing').toBe(true);
    expect(existsSync(themeModelPath), 'theme model is missing').toBe(true);

    if (!existsSync(publicApiPath) || !existsSync(themeModelPath)) {
      return;
    }

    const publicApi = readFileSync(publicApiPath, 'utf8');
    const themeModel = readFileSync(themeModelPath, 'utf8');

    expect(publicApi).toContain("export { createThemeModel, themeModel } from './theme';");
    expect(publicApi).toContain("export type { ResolvedTheme, ThemeModel, ThemePreference } from './theme';");
    expect(themeModel).not.toMatch(/\b(?:document|window|localStorage|matchMedia)\b/);
  });
});
