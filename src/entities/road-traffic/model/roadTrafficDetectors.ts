import { z } from 'zod';

export const ROAD_TRAFFIC_DETECTOR_METRIC_UNIT = 'provider-unspecified' as const;
export const ROAD_TRAFFIC_DETECTOR_SOURCE_TIME_BASIS = 'provider-local-unspecified' as const;
export const ROAD_TRAFFIC_DETECTOR_MAX_ID_LENGTH = 64;
export const ROAD_TRAFFIC_DETECTOR_MAX_LINKS = 25;
export const ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS = 30_000;
export const ROAD_TRAFFIC_DETECTOR_MAX_SERIALIZED_BYTES = 2.5 * 1_024 * 1_024;

export type RoadTrafficDetectorObservation = readonly [
  laneNumber: number,
  observedAtSource: string,
  speed: number | null,
  volume: number | null,
  occupancy: number | null,
];

export type RoadTrafficDetector = Readonly<{
  detectorId: string;
  linkedRoadSegmentIds: readonly string[];
  observations: readonly RoadTrafficDetectorObservation[];
}>;

export type RoadTrafficDetectorSnapshot = Readonly<{
  detectors: readonly RoadTrafficDetector[];
  generatedAt: number;
  occupancyUnit: typeof ROAD_TRAFFIC_DETECTOR_METRIC_UNIT;
  sourceTimeBasis: typeof ROAD_TRAFFIC_DETECTOR_SOURCE_TIME_BASIS;
  speedUnit: typeof ROAD_TRAFFIC_DETECTOR_METRIC_UNIT;
  volumeUnit: typeof ROAD_TRAFFIC_DETECTOR_METRIC_UNIT;
}>;

const canonicalIdSchema = z
  .string()
  .min(1)
  .max(ROAD_TRAFFIC_DETECTOR_MAX_ID_LENGTH)
  .refine((value) => value.trim().length > 0 && value === value.trim(), 'Detector identifiers must be canonical');
const canonicalLinkIdSchema = z.string().regex(/^\d{1,64}$/u, 'Detector link identifiers must be numeric');

const isValidSourceTimestamp = (value: string): boolean => {
  if (!/^\d{14}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() + 1 === month &&
    calendar.getUTCDate() === day &&
    calendar.getUTCHours() === hour &&
    calendar.getUTCMinutes() === minute &&
    calendar.getUTCSeconds() === second
  );
};

const nullableNonnegativeMetricSchema = (maximum: number) => z.number().finite().min(0).max(maximum).nullable();
const nullableOccupancySchema = z.number().finite().gt(-1).max(1_000_000_000).nullable();

const roadTrafficDetectorObservationSchema: z.ZodType<RoadTrafficDetectorObservation> = z.tuple([
  z.number().int().min(0).max(32),
  z.string().refine(isValidSourceTimestamp, 'Detector source timestamp is invalid'),
  nullableNonnegativeMetricSchema(300),
  nullableNonnegativeMetricSchema(1_000_000_000),
  nullableOccupancySchema,
]);

export const compareRoadTrafficDetectorObservations = (
  left: RoadTrafficDetectorObservation,
  right: RoadTrafficDetectorObservation,
): number => {
  const timestampOrder = left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
  return timestampOrder === 0 ? left[0] - right[0] : timestampOrder;
};

const detectorGroupIdentity = (detector: Pick<RoadTrafficDetector, 'detectorId' | 'linkedRoadSegmentIds'>): string =>
  `${detector.detectorId}\u0000${detector.linkedRoadSegmentIds.join('\u0001')}`;

export const compareRoadTrafficDetectors = (left: RoadTrafficDetector, right: RoadTrafficDetector): number => {
  const leftIdentity = detectorGroupIdentity(left);
  const rightIdentity = detectorGroupIdentity(right);
  return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
};

const roadTrafficDetectorSchema: z.ZodType<RoadTrafficDetector> = z
  .object({
    detectorId: canonicalIdSchema,
    linkedRoadSegmentIds: z.array(canonicalLinkIdSchema).min(1).max(ROAD_TRAFFIC_DETECTOR_MAX_LINKS),
    observations: z.array(roadTrafficDetectorObservationSchema).min(1).max(ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS),
  })
  .strict()
  .superRefine((detector, context) => {
    const links = new Set<string>();
    for (const [index, linkId] of detector.linkedRoadSegmentIds.entries()) {
      if (links.has(linkId)) {
        context.addIssue({
          code: 'custom',
          message: 'Detector links must be unique',
          path: ['linkedRoadSegmentIds', index],
        });
      }
      links.add(linkId);
    }

    const observations = new Set<string>();
    for (const [index, observation] of detector.observations.entries()) {
      const identity = `${observation[0]}\u0000${observation[1]}`;
      if (observations.has(identity)) {
        context.addIssue({
          code: 'custom',
          message: 'Detector observations must be unique',
          path: ['observations', index],
        });
      }
      observations.add(identity);
      const previous = detector.observations[index - 1];
      if (previous !== undefined && compareRoadTrafficDetectorObservations(previous, observation) >= 0) {
        context.addIssue({
          code: 'custom',
          message: 'Detector observations must use deterministic order',
          path: ['observations', index],
        });
      }
    }
  });

export const roadTrafficDetectorSnapshotSchema: z.ZodType<RoadTrafficDetectorSnapshot> = z
  .object({
    detectors: z.array(roadTrafficDetectorSchema).max(ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS),
    generatedAt: z.number().finite().int().nonnegative().safe().max(8_640_000_000_000_000),
    occupancyUnit: z.literal(ROAD_TRAFFIC_DETECTOR_METRIC_UNIT),
    sourceTimeBasis: z.literal(ROAD_TRAFFIC_DETECTOR_SOURCE_TIME_BASIS),
    speedUnit: z.literal(ROAD_TRAFFIC_DETECTOR_METRIC_UNIT),
    volumeUnit: z.literal(ROAD_TRAFFIC_DETECTOR_METRIC_UNIT),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const groups = new Set<string>();
    let observationCount = 0;
    for (const [index, detector] of snapshot.detectors.entries()) {
      observationCount += detector.observations.length;
      const identity = detectorGroupIdentity(detector);
      if (groups.has(identity)) {
        context.addIssue({ code: 'custom', message: 'Detector groups must be unique', path: ['detectors', index] });
      }
      groups.add(identity);
      const previous = snapshot.detectors[index - 1];
      if (previous !== undefined && compareRoadTrafficDetectors(previous, detector) >= 0) {
        context.addIssue({
          code: 'custom',
          message: 'Detector groups must use deterministic order',
          path: ['detectors', index],
        });
      }
    }
    if (observationCount > ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS) {
      context.addIssue({ code: 'custom', message: 'Detector observation count exceeds the product limit', path: [] });
    }
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > ROAD_TRAFFIC_DETECTOR_MAX_SERIALIZED_BYTES) {
      context.addIssue({ code: 'custom', message: 'Detector snapshot exceeds the serialized payload limit', path: [] });
    }
  });

export const roadTrafficDetectorDataSchema = roadTrafficDetectorSnapshotSchema;
