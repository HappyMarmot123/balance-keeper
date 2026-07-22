// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const weatherPublicApiPath = resolve(process.cwd(), 'src/entities/weather/index.ts');
const readWeatherPublicApi = () => (existsSync(weatherPublicApiPath) ? readFileSync(weatherPublicApiPath, 'utf8') : '');

describe('weather entity public boundary', () => {
  it('owns a public API entrypoint inside the weather entity slice', () => {
    expect(existsSync(weatherPublicApiPath), 'src/entities/weather/index.ts must exist').toBe(true);
  });

  it.each([
    'WEATHER_NOWCAST_QUERY_PROFILE',
    'WEATHER_REGIONS',
    'createWeatherNowcastPath',
    'weatherNowcastDataSchema',
    'weatherNowcastQueryOptions',
  ])('exposes %s through the slice public API', (publicName) => {
    expect(readWeatherPublicApi()).toMatch(new RegExp(`\\b${publicName}\\b`));
  });

  it('does not make client code depend on the server implementation tree', () => {
    expect(readWeatherPublicApi()).not.toMatch(/(?:src\/server|\.\.\/\.\.\/server|server\/providers\/kma)/);
  });
});
