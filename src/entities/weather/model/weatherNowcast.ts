import { z } from 'zod';

import type { SuccessEnvelope } from '../../../shared/contracts';

const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

export const weatherRegionIdSchema = z.enum(['seoul', 'busan', 'incheon', 'daegu', 'gwangju', 'daejeon', 'jeju']);

export type WeatherRegionId = z.infer<typeof weatherRegionIdSchema>;

export type WeatherRegion = Readonly<{
  id: WeatherRegionId;
  name: string;
  nx: number;
  ny: number;
}>;

const defineRegion = (region: WeatherRegion): WeatherRegion => Object.freeze(region);

export const WEATHER_REGIONS = Object.freeze({
  busan: defineRegion({ id: 'busan', name: '부산', nx: 98, ny: 76 }),
  daegu: defineRegion({ id: 'daegu', name: '대구', nx: 89, ny: 90 }),
  daejeon: defineRegion({ id: 'daejeon', name: '대전', nx: 67, ny: 100 }),
  gwangju: defineRegion({ id: 'gwangju', name: '광주', nx: 58, ny: 74 }),
  incheon: defineRegion({ id: 'incheon', name: '인천', nx: 55, ny: 124 }),
  jeju: defineRegion({ id: 'jeju', name: '제주', nx: 52, ny: 38 }),
  seoul: defineRegion({ id: 'seoul', name: '서울', nx: 60, ny: 127 }),
} satisfies Record<WeatherRegionId, WeatherRegion>);

export const weatherPrecipitationTypeSchema = z.enum([
  'none',
  'rain',
  'rain-snow',
  'snow',
  'raindrop',
  'raindrop-snow-flurry',
  'snow-flurry',
]);

export const weatherNowcastSchema = z
  .object({
    observedAt: z.number().int().nonnegative().max(MAX_DATE_EPOCH_MS),
    precipitationLastHourMm: z.number().finite().nonnegative().nullable(),
    precipitationType: weatherPrecipitationTypeSchema.nullable(),
    region: weatherRegionIdSchema,
    relativeHumidityPercent: z.number().finite().min(0).max(100).nullable(),
    temperatureCelsius: z.number().finite().nullable(),
    windDirectionDegrees: z.number().finite().min(0).max(360).nullable(),
    windSpeedMetersPerSecond: z.number().finite().nonnegative().nullable(),
  })
  .strict();

export const weatherNowcastDataSchema = weatherNowcastSchema.nullable();

export type WeatherPrecipitationType = z.infer<typeof weatherPrecipitationTypeSchema>;
export type WeatherNowcast = z.infer<typeof weatherNowcastSchema>;
export type WeatherNowcastData = z.infer<typeof weatherNowcastDataSchema>;
export type WeatherNowcastEnvelope = SuccessEnvelope<typeof weatherNowcastDataSchema>;
