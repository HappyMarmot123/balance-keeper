import { z } from 'zod';

import type { SuccessEnvelope } from '../../../shared/contracts';
import { weatherRegionIdSchema } from './weatherNowcast';

const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;
const HOUR_MS = 60 * 60_000;

export const weatherForecastSkyConditionSchema = z.enum(['clear', 'mostly-cloudy', 'overcast']);

export const weatherForecastPrecipitationTypeSchema = z.enum(['none', 'rain', 'rain-snow', 'snow', 'shower']);

const millimetersSchema = z.number().finite().nonnegative();

export const weatherForecastPrecipitationAmountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('less-than'), millimeters: millimetersSchema.positive() }).strict(),
  z.object({ kind: z.literal('amount'), millimeters: millimetersSchema }).strict(),
  z
    .object({
      kind: z.literal('range'),
      maximumMillimeters: millimetersSchema,
      minimumMillimeters: millimetersSchema,
    })
    .strict()
    .refine((value) => value.maximumMillimeters > value.minimumMillimeters),
  z.object({ kind: z.literal('at-least'), millimeters: millimetersSchema }).strict(),
]);

const forecastAtSchema = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_DATE_EPOCH_MS)
  .refine((epochMs) => epochMs % HOUR_MS === 0, 'Weather forecast timestamps must align to an exact hour');

export const weatherForecastAvailablePeriodSchema = z
  .object({
    availability: z.literal('available'),
    forecastAt: forecastAtSchema,
    precipitationAmount: weatherForecastPrecipitationAmountSchema.nullable(),
    precipitationProbabilityPercent: z.number().finite().min(0).max(100).nullable(),
    precipitationType: weatherForecastPrecipitationTypeSchema.nullable(),
    relativeHumidityPercent: z.number().finite().min(0).max(100).nullable(),
    skyCondition: weatherForecastSkyConditionSchema.nullable(),
    temperatureCelsius: z.number().finite().nullable(),
    windSpeedMetersPerSecond: z.number().finite().nonnegative().nullable(),
  })
  .strict()
  .refine(
    (period) =>
      period.precipitationAmount !== null ||
      period.precipitationProbabilityPercent !== null ||
      period.precipitationType !== null ||
      period.relativeHumidityPercent !== null ||
      period.skyCondition !== null ||
      period.temperatureCelsius !== null ||
      period.windSpeedMetersPerSecond !== null,
  );

export const weatherForecastUnavailablePeriodSchema = z
  .object({
    availability: z.literal('unavailable'),
    forecastAt: forecastAtSchema,
  })
  .strict();

export const weatherForecastPeriodSchema = z.discriminatedUnion('availability', [
  weatherForecastAvailablePeriodSchema,
  weatherForecastUnavailablePeriodSchema,
]);

export const weatherForecastSchema = z
  .object({
    issuedAt: forecastAtSchema,
    periods: z.array(weatherForecastPeriodSchema).length(24),
    region: weatherRegionIdSchema,
  })
  .strict()
  .superRefine((forecast, context) => {
    for (let index = 1; index < forecast.periods.length; index += 1) {
      const previous = forecast.periods[index - 1];
      const current = forecast.periods[index];
      if (previous !== undefined && current !== undefined && current.forecastAt - previous.forecastAt !== HOUR_MS) {
        context.addIssue({
          code: 'custom',
          message: 'Weather forecast periods must be consecutive hours',
          path: ['periods', index, 'forecastAt'],
        });
      }
    }
  });

export const weatherForecastDataSchema = weatherForecastSchema.nullable();

export type WeatherForecast = z.infer<typeof weatherForecastSchema>;
export type WeatherForecastAvailablePeriod = z.infer<typeof weatherForecastAvailablePeriodSchema>;
export type WeatherForecastData = z.infer<typeof weatherForecastDataSchema>;
export type WeatherForecastEnvelope = SuccessEnvelope<typeof weatherForecastDataSchema>;
export type WeatherForecastPeriod = z.infer<typeof weatherForecastPeriodSchema>;
export type WeatherForecastPrecipitationAmount = z.infer<typeof weatherForecastPrecipitationAmountSchema>;
export type WeatherForecastPrecipitationType = z.infer<typeof weatherForecastPrecipitationTypeSchema>;
export type WeatherForecastSkyCondition = z.infer<typeof weatherForecastSkyConditionSchema>;
