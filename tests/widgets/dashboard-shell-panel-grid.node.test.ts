// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard panel grid contract', () => {
  it('owns the shared 3×3-like dashboard panel shape with official ordering', () => {
    const panelGridSource = readSource('src/widgets/dashboard-shell/ui/PanelGrid.tsx');

    expect(panelGridSource).toContain('className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3"');
    const slotOrder = [
      'weatherSlot',
      'forecastSlot',
      'airQualitySlot',
      'earthquakeSlot',
      'disasterSlot',
      'macroSlot',
      'marketsSlot',
      'newsSlot',
      'regionalContextSlot',
    ];

    for (const slot of slotOrder) {
      expect(panelGridSource).toContain(`${slot}`);
      expect(panelGridSource.match(new RegExp(`\\{${slot}\\}`, 'g')) ?? []).toHaveLength(1);
    }

    const firstWeather = panelGridSource.indexOf('{weatherSlot}');
    const firstForecast = panelGridSource.indexOf('{forecastSlot}');
    const firstAirQuality = panelGridSource.indexOf('{airQualitySlot}');
    const firstRegional = panelGridSource.indexOf('{regionalContextSlot}');
    expect(firstWeather).toBeGreaterThan(-1);
    expect(firstForecast).toBeGreaterThan(firstWeather);
    expect(firstAirQuality).toBeGreaterThan(firstForecast);
    expect(firstRegional).toBeGreaterThan(firstWeather);
    expect(firstRegional).toBeGreaterThan(firstAirQuality);
  });
});
