// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard weather composition boundary', () => {
  it('composes the public weather widgets without owning remote or transient state', () => {
    const pageSource = readSource('src/pages/dashboard/ui/DashboardPage.tsx');

    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/weather-nowcast['"]/);
    expect(pageSource).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/widgets\/weather-forecast['"]/);
    expect(pageSource).toContain('weatherSlot={<WeatherNowcastWidget />}');
    expect(pageSource).toContain('forecastSlot={<WeatherForecastWidget />}');
    expect(pageSource).not.toMatch(/\b(?:useQuery|useEffect|useState|signal|computed)\b/);
    expect(pageSource).not.toMatch(/entities\/weather/);
  });

  it('renders the forecast slot once immediately after the weather nowcast', () => {
    const shellSource = readSource('src/widgets/dashboard-shell/ui/DashboardShell.tsx');
    const renderedSlots = shellSource.match(/\{weatherSlot\}/g) ?? [];
    const renderedForecastSlots = shellSource.match(/\{forecastSlot\}/g) ?? [];

    expect(shellSource).toMatch(/weatherSlot:\s*ComponentChildren/);
    expect(shellSource).toMatch(/forecastSlot:\s*ComponentChildren/);
    expect(renderedSlots).toHaveLength(1);
    expect(renderedForecastSlots).toHaveLength(1);
    expect(shellSource).toMatch(/\{weatherSlot\}\s*\{forecastSlot\}/);
    expect(shellSource).toContain('md:grid-cols-2 2xl:grid-cols-3');
  });
});
