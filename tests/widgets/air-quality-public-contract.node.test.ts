// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetRoot = resolve(process.cwd(), 'src/widgets/air-quality');
const publicApiPath = resolve(widgetRoot, 'index.ts');
const viewPath = resolve(widgetRoot, 'ui/AirQualityView.tsx');
const widgetPath = resolve(widgetRoot, 'ui/AirQualityWidget.tsx');

describe('air-quality widget public boundary', () => {
  it('exposes one public widget while keeping its view internal', () => {
    expect(existsSync(publicApiPath), 'air-quality widget public API must exist').toBe(true);
    expect(existsSync(viewPath), 'AirQualityView must exist inside the widget slice').toBe(true);
    expect(existsSync(widgetPath), 'AirQualityWidget must exist inside the widget slice').toBe(true);

    if (!existsSync(publicApiPath)) {
      return;
    }

    const publicApi = readFileSync(publicApiPath, 'utf8');

    expect(publicApi).toContain("export { AirQualityWidget } from './ui/AirQualityWidget';");
    expect(publicApi).not.toMatch(/AirQualityView/);
  });
});
