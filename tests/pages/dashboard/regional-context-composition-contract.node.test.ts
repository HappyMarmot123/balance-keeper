// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard regional context composition boundary', () => {
  it('composes the public widget without owning remote state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/regional-context['"]/);
    expect(pageSource).toContain('regionalContextSlot={<RegionalContextWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/(?:weather|earthquake|market|news)/);
    expect(pageSource).not.toMatch(/widgets\/regional-context\/(?:ui|model|api|lib)\//);
  });

  it('gives regional context one explicit shell slot in the data grid', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const renderedSlots = shellSource.match(/\{regionalContextSlot\}/g) ?? [];

    expect(shellSource).toMatch(/regionalContextSlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
  });
});
