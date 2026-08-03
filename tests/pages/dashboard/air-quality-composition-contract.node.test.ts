// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard air-quality composition boundary', () => {
  it('composes the public air-quality widget without owning its remote state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/air-quality['"]/);
    expect(pageSource).toContain('airQualitySlot={<AirQualityWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/air-quality/);
    expect(pageSource).not.toMatch(/widgets\/air-quality\/(?:ui|model|api|lib)\//);
  });

  it('gives air quality an explicit shell slot and renders it once', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const panelGridSource = readSource('src/widgets/dashboard-shell/ui/PanelGrid.tsx');
    const renderedSlots = shellSource.match(/\{airQualitySlot\}/g) ?? [];

    expect(panelGridSource).toMatch(/airQualitySlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
  });
});
