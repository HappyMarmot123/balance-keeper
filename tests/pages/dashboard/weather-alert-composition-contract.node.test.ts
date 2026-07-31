// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  resolve(import.meta.dirname, '../../../src/pages/dashboard/ui/DashboardPage.tsx'),
  'utf8',
);
const shellSource = readFileSync(
  resolve(import.meta.dirname, '../../../src/widgets/dashboard-shell/ui/DashboardShell.tsx'),
  'utf8',
);

describe('weather-alert dashboard composition boundary', () => {
  it('imports the weather-alert widget only through its public API', () => {
    expect(pageSource).toContain("from '../../../widgets/weather-alert'");
    expect(pageSource).not.toMatch(/widgets\/weather-alert\/(?:ui|api|model)\//u);
    expect(pageSource).not.toMatch(/entities\/weather-alert|useQuery|signal/u);
  });

  it('places one full-width alert strip after the map and before the unchanged 3x3 panel grid', () => {
    const mapPosition = shellSource.indexOf('{mapSlot}');
    const alertPosition = shellSource.indexOf('{weatherAlertSlot}');
    const gridPosition = shellSource.indexOf('md:grid-cols-2 2xl:grid-cols-3');

    expect(mapPosition).toBeGreaterThan(-1);
    expect(alertPosition).toBeGreaterThan(mapPosition);
    expect(gridPosition).toBeGreaterThan(alertPosition);
    expect(shellSource.match(/\{weatherAlertSlot\}/gu)).toHaveLength(1);
    expect(shellSource).toContain('weatherAlertSlot: ComponentChildren');
  });

  it('keeps all nine established dashboard slots in the existing grid', () => {
    const gridSource = shellSource.slice(shellSource.indexOf('md:grid-cols-2 2xl:grid-cols-3'));
    for (const slot of [
      'weatherSlot',
      'forecastSlot',
      'airQualitySlot',
      'earthquakeSlot',
      'disasterSlot',
      'macroSlot',
      'marketsSlot',
      'newsSlot',
      'regionalContextSlot',
    ]) {
      expect(gridSource).toContain(`{${slot}}`);
    }
  });
});
