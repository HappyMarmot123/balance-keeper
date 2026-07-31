// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as weatherEntity from '../../../src/entities/weather';

type RuntimeSchema = Readonly<{
  parse(input: unknown): unknown;
  safeParse(input: unknown): Readonly<{ success: boolean }>;
}>;

const readForecastSchema = (): RuntimeSchema | undefined =>
  (weatherEntity as Readonly<Record<string, unknown>>).weatherForecastDataSchema as RuntimeSchema | undefined;

const forecastAt = Date.parse('2026-07-31T10:00:00+09:00');

const createForecast = () => ({
  issuedAt: Date.parse('2026-07-31T08:00:00+09:00'),
  periods: Array.from({ length: 24 }, (_, index) =>
    index === 0
      ? {
          availability: 'available',
          forecastAt: forecastAt + index * 60 * 60_000,
          precipitationAmount: { kind: 'less-than', millimeters: 1 },
          precipitationProbabilityPercent: 30,
          precipitationType: 'rain',
          relativeHumidityPercent: 70,
          skyCondition: 'overcast',
          temperatureCelsius: 28.4,
          windSpeedMetersPerSecond: 2.7,
        }
      : {
          availability: 'unavailable',
          forecastAt: forecastAt + index * 60 * 60_000,
        },
  ),
  region: 'seoul',
});

describe('weather forecast public contract', () => {
  it('exports a strict nullable 24-hour forecast schema', () => {
    const schema = readForecastSchema();

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(createForecast())).toEqual(createForecast());
    expect(schema.parse(null)).toBeNull();
  });

  it('rejects non-hourly periods and invalid measurement boundaries', () => {
    const schema = readForecastSchema();

    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    const nonHourly = createForecast();
    nonHourly.periods[1] = {
      availability: 'unavailable',
      forecastAt: forecastAt + 90 * 60_000,
    };
    const invalidHumidity = createForecast();
    const firstPeriod = invalidHumidity.periods[0];
    if (firstPeriod === undefined) {
      throw new TypeError('Forecast fixture must contain a first period');
    }
    Object.assign(firstPeriod, { relativeHumidityPercent: 101 });
    const halfHourTimeline = createForecast();
    halfHourTimeline.periods = halfHourTimeline.periods.map((period) => ({
      ...period,
      forecastAt: period.forecastAt + 30 * 60_000,
    }));

    expect(schema.safeParse(nonHourly).success).toBe(false);
    expect(schema.safeParse(invalidHumidity).success).toBe(false);
    expect(schema.safeParse(halfHourTimeline).success).toBe(false);
    expect(schema.safeParse({ ...createForecast(), providerSecret: 'must-not-pass' }).success).toBe(false);
  });
});
