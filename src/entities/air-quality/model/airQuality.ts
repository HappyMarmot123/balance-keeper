import { z } from 'zod';

export type AirQualityRegionId = 'seoul' | 'busan' | 'incheon' | 'daegu' | 'gwangju' | 'daejeon' | 'jeju';
export type AirPollutant = 'pm10' | 'pm25';
export type AirQualityGrade = 'good' | 'moderate' | 'bad' | 'very-bad';

export type AirQualityRegion = Readonly<{
  id: AirQualityRegionId;
  name: string;
  providerName: string;
}>;

const defineRegion = (region: AirQualityRegion): AirQualityRegion => Object.freeze(region);

export const AIR_QUALITY_REGIONS = Object.freeze({
  busan: defineRegion({ id: 'busan', name: '부산', providerName: '부산' }),
  daegu: defineRegion({ id: 'daegu', name: '대구', providerName: '대구' }),
  daejeon: defineRegion({ id: 'daejeon', name: '대전', providerName: '대전' }),
  gwangju: defineRegion({ id: 'gwangju', name: '광주', providerName: '광주' }),
  incheon: defineRegion({ id: 'incheon', name: '인천', providerName: '인천' }),
  jeju: defineRegion({ id: 'jeju', name: '제주', providerName: '제주' }),
  seoul: defineRegion({ id: 'seoul', name: '서울', providerName: '서울' }),
} satisfies Record<AirQualityRegionId, AirQualityRegion>);

const koreanRegionAliases = Object.freeze(
  Object.fromEntries(Object.values(AIR_QUALITY_REGIONS).map((region) => [region.name, region.id] as const)) as Record<
    string,
    AirQualityRegionId
  >,
);

export const normalizeAirQualityRegion = (input: string): AirQualityRegionId | undefined => {
  const normalized = input.trim();
  const semanticId = normalized.toLowerCase();

  if (Object.hasOwn(AIR_QUALITY_REGIONS, semanticId)) {
    return semanticId as AirQualityRegionId;
  }

  return Object.hasOwn(koreanRegionAliases, normalized) ? koreanRegionAliases[normalized] : undefined;
};

const gradeThresholds = {
  pm10: [30, 80, 150],
  pm25: [15, 35, 75],
} as const satisfies Record<AirPollutant, readonly [number, number, number]>;

// AirKorea documents PM concentration fields with a width of 10 characters.
// This is the largest non-negative integer representable by that transport field.
export const MAX_AIR_QUALITY_CONCENTRATION = 9_999_999_999;

export const classifyAirQualityGrade = (pollutant: AirPollutant, concentration: number): AirQualityGrade => {
  if (!Number.isFinite(concentration) || concentration < 0 || concentration > MAX_AIR_QUALITY_CONCENTRATION) {
    throw new RangeError('Air-quality concentration is outside its supported range');
  }

  const [goodMaximum, moderateMaximum, badMaximum] = gradeThresholds[pollutant];

  if (concentration <= goodMaximum) {
    return 'good';
  }
  if (concentration <= moderateMaximum) {
    return 'moderate';
  }
  if (concentration <= badMaximum) {
    return 'bad';
  }
  return 'very-bad';
};

const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

export const airQualityRegionIdSchema = z.enum(['seoul', 'busan', 'incheon', 'daegu', 'gwangju', 'daejeon', 'jeju']);

export const airQualityGradeSchema = z.enum(['good', 'moderate', 'bad', 'very-bad']);

const pollutantReadingSchema = z
  .object({
    concentration: z.number().finite().nonnegative().max(MAX_AIR_QUALITY_CONCENTRATION).nullable(),
    grade: airQualityGradeSchema.nullable(),
  })
  .strict();

const createPollutantReadingSchema = (pollutant: AirPollutant) =>
  pollutantReadingSchema.superRefine((reading, context) => {
    if (reading.concentration === null) {
      if (reading.grade !== null) {
        context.addIssue({ code: 'custom', message: 'Missing concentration must have a null grade', path: ['grade'] });
      }
      return;
    }

    if (
      !Number.isFinite(reading.concentration) ||
      reading.concentration < 0 ||
      reading.concentration > MAX_AIR_QUALITY_CONCENTRATION
    ) {
      return;
    }

    if (reading.grade !== classifyAirQualityGrade(pollutant, reading.concentration)) {
      context.addIssue({
        code: 'custom',
        message: 'Pollutant grade must match its concentration',
        path: ['grade'],
      });
    }
  });

export const airQualityStationSchema = z
  .object({
    address: z.string().min(1),
    latitude: z.number().finite().min(32).max(39),
    longitude: z.number().finite().min(124).max(132),
    networkName: z.string().min(1),
    observedAt: z.number().int().nonnegative().max(MAX_DATE_EPOCH_MS),
    pm10: createPollutantReadingSchema('pm10'),
    pm25: createPollutantReadingSchema('pm25'),
    providerRegionName: z.string().min(1),
    regionId: airQualityRegionIdSchema,
    stationName: z.string().min(1),
  })
  .strict();

export const airQualitySnapshotSchema = z
  .object({
    observedAt: z.number().int().nonnegative().max(MAX_DATE_EPOCH_MS),
    observedStationCount: z.number().int().nonnegative().max(100),
    region: airQualityRegionIdSchema,
    stations: z.array(airQualityStationSchema).max(100),
    totalStationCount: z.number().int().positive().max(100),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.totalStationCount !== snapshot.stations.length) {
      context.addIssue({
        code: 'custom',
        message: 'Total station count must match the normalized station collection',
        path: ['totalStationCount'],
      });
    }

    const observedStationCount = snapshot.stations.filter(
      (station) => station.pm10.concentration !== null || station.pm25.concentration !== null,
    ).length;
    if (snapshot.observedStationCount !== observedStationCount) {
      context.addIssue({
        code: 'custom',
        message: 'Observed station count must match stations with at least one pollutant observation',
        path: ['observedStationCount'],
      });
    }

    const latestObservedAt = Math.max(...snapshot.stations.map((station) => station.observedAt));
    if (snapshot.observedAt !== latestObservedAt) {
      context.addIssue({
        code: 'custom',
        message: 'Snapshot observation time must be the latest station observation time',
        path: ['observedAt'],
      });
    }

    const expectedProviderName = AIR_QUALITY_REGIONS[snapshot.region].providerName;
    snapshot.stations.forEach((station, index) => {
      if (station.regionId !== snapshot.region) {
        context.addIssue({
          code: 'custom',
          message: 'Station region must match the canonical snapshot region',
          path: ['stations', index, 'regionId'],
        });
      }

      if (station.providerRegionName !== expectedProviderName) {
        context.addIssue({
          code: 'custom',
          message: 'Station provider region must match the canonical snapshot region',
          path: ['stations', index, 'providerRegionName'],
        });
      }
    });
  });

export const airQualityDataSchema = airQualitySnapshotSchema.nullable();

export type PollutantReading = z.infer<typeof pollutantReadingSchema>;
export type AirQualityStation = z.infer<typeof airQualityStationSchema>;
export type AirQualitySnapshot = z.infer<typeof airQualitySnapshotSchema>;

export type AirQualitySummary = Readonly<{
  highest: Readonly<{
    concentration: number;
    grade: AirQualityGrade;
    stationName: string;
  }> | null;
  observedStationCount: number;
  pollutant: AirPollutant;
  totalStationCount: number;
}>;

export const selectAirQualitySummary = (snapshot: AirQualitySnapshot, pollutant: AirPollutant): AirQualitySummary => {
  const observations = snapshot.stations
    .flatMap((station) => {
      const reading = station[pollutant];
      return reading.concentration === null || reading.grade === null
        ? []
        : [{ concentration: reading.concentration, grade: reading.grade, stationName: station.stationName }];
    })
    .sort((left, right) => {
      const concentrationOrder = right.concentration - left.concentration;
      if (concentrationOrder !== 0) {
        return concentrationOrder;
      }
      return left.stationName < right.stationName ? -1 : left.stationName > right.stationName ? 1 : 0;
    });

  return {
    highest: observations[0] ?? null,
    observedStationCount: observations.length,
    pollutant,
    totalStationCount: snapshot.totalStationCount,
  };
};
