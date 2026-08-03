// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard disaster composition boundary', () => {
  it('composes the public disaster widget without owning remote or transient state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/disaster['"]/);
    expect(pageSource).toContain('disasterSlot={<DisasterWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/disaster/);
    expect(pageSource).not.toMatch(/widgets\/disaster\/(?:ui|model|api|lib)\//);
  });

  it('gives disaster one explicit shell slot in the existing data grid', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const panelGridSource = readSource('src/widgets/dashboard-shell/ui/PanelGrid.tsx');
    const renderedSlots = shellSource.match(/\{disasterSlot\}/g) ?? [];

    expect(panelGridSource).toMatch(/disasterSlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
  });
});
