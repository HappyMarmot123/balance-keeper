// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard news composition boundary', () => {
  it('composes the public news widget without owning remote state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/news['"]/);
    expect(pageSource).toContain('newsSlot={<NewsWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/news/);
    expect(pageSource).not.toMatch(/widgets\/news\/(?:ui|model|api|lib)\//);
  });

  it('gives news one explicit shell slot in the existing data grid', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const renderedSlots = shellSource.match(/\{newsSlot\}/g) ?? [];

    expect(shellSource).toMatch(/newsSlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
  });
});
