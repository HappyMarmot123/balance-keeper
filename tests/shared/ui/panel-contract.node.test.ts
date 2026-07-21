// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(process.cwd());
const publicApiPath = resolve(projectRoot, 'src/shared/ui/index.ts');
const panelPath = resolve(projectRoot, 'src/shared/ui/panel/Panel.tsx');

describe('shared Panel public API', () => {
  it('exposes the component and its lifecycle contract from shared/ui', () => {
    expect(existsSync(publicApiPath), 'shared/ui public API is missing').toBe(true);
    expect(existsSync(panelPath), 'Panel implementation is missing').toBe(true);

    if (!existsSync(publicApiPath) || !existsSync(panelPath)) {
      return;
    }

    const publicApi = readFileSync(publicApiPath, 'utf8');

    expect(publicApi).toContain("export { Panel } from './panel/Panel';");
    expect(publicApi).toContain("export type { PanelFreshness, PanelProps, PanelStatus } from './panel/Panel';");
  });
});
