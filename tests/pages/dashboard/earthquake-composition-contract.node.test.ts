// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard earthquake composition boundary', () => {
  it('composes the public earthquake widget without owning remote state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/earthquake['"]/);
    expect(pageSource).toContain('earthquakeSlot={<EarthquakeWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/earthquake/);
    expect(pageSource).not.toMatch(/widgets\/earthquake\/(?:ui|model|api|lib)\//);
  });

  it('gives earthquake one explicit shell slot in the existing data grid', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const renderedSlots = shellSource.match(/\{earthquakeSlot\}/g) ?? [];

    expect(shellSource).toMatch(/earthquakeSlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
    expect(shellSource).toContain('xl:grid-cols-4');
  });
});
