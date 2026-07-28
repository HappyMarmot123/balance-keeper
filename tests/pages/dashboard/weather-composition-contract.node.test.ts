// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard weather composition boundary', () => {
  it('composes the public weather widget without owning remote or transient state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/weather-nowcast['"]/);
    expect(pageSource).toContain('weatherSlot={<WeatherNowcastWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/weather/);
  });

  it('gives the weather region an explicit shell slot and renders it once', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const renderedSlots = shellSource.match(/\{weatherSlot\}/g) ?? [];

    expect(shellSource).toMatch(/weatherSlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
  });
});
