// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard markets composition boundary', () => {
  it('composes the public markets widget without owning remote state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/markets['"]/);
    expect(pageSource).toContain('marketsSlot={<MarketsWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/market/);
    expect(pageSource).not.toMatch(/widgets\/markets\/(?:ui|model|api|lib)\//);
  });

  it('gives markets one explicit shell slot without collapsing panel width at the xl boundary', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const gridSource = readSource('src/widgets/dashboard-shell/ui/PanelGrid.tsx');
    const renderedSlots = shellSource.match(/\{marketsSlot\}/g) ?? [];

    expect(gridSource).toMatch(/marketsSlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
    expect(gridSource).toContain('className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3"');
    expect(gridSource).toContain('marketsSlot');
    expect(shellSource).not.toContain('xl:grid-cols-5');
  });
});
