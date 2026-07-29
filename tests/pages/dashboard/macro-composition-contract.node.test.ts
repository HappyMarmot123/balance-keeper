// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard macro composition boundary', () => {
  it('composes the public macro widget without owning remote state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/macro['"]/);
    expect(pageSource).toContain('macroSlot={<MacroWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/macro/);
    expect(pageSource).not.toMatch(/widgets\/macro\/(?:ui|model|api|lib)\//);
  });

  it('gives macro one explicit shell slot in the desktop data grid', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const renderedSlots = shellSource.match(/\{macroSlot\}/g) ?? [];

    expect(shellSource).toMatch(/macroSlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
  });
});
