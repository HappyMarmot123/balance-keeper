import { z } from 'zod';

export const ROAD_TRAFFIC_FORECAST_SPEED_UNIT = 'provider-unspecified' as const;
export const ROAD_TRAFFIC_FORECAST_MAX_SEGMENTS = 1_000;
export const ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH = 64;
export const ROAD_TRAFFIC_FORECAST_MAX_SERIALIZED_BYTES = 128 * 1024;

export type RoadTrafficForecastSegment = Readonly<{
  linkId: string;
  sectionTypeCode: 'D' | 'M';
  speed: number;
  speedUnit: typeof ROAD_TRAFFIC_FORECAST_SPEED_UNIT;
}>;

export type RoadTrafficForecastSnapshot = Readonly<{
  forecastAt: number;
  sectionId: string;
  segments: readonly RoadTrafficForecastSegment[];
}>;

const canonicalIdSchema = z
  .string()
  .min(1)
  .max(ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH)
  .refine((value) => value.trim().length > 0, 'Road traffic forecast identifier must not be blank')
  .refine((value) => value === value.trim(), 'Road traffic forecast identifier must be canonical');

const roadTrafficForecastSegmentSchema: z.ZodType<RoadTrafficForecastSegment> = z
  .object({
    linkId: canonicalIdSchema,
    sectionTypeCode: z.enum(['D', 'M']),
    speed: z.number().finite().min(0).max(300),
    speedUnit: z.literal(ROAD_TRAFFIC_FORECAST_SPEED_UNIT),
  })
  .strict();

const segmentIdentity = (segment: RoadTrafficForecastSegment): string =>
  `${segment.sectionTypeCode}\u0000${segment.linkId}`;

export const compareRoadTrafficForecastSegments = (
  left: RoadTrafficForecastSegment,
  right: RoadTrafficForecastSegment,
): number => {
  const leftIdentity = segmentIdentity(left);
  const rightIdentity = segmentIdentity(right);
  if (leftIdentity < rightIdentity) {
    return -1;
  }
  return leftIdentity > rightIdentity ? 1 : 0;
};

export const roadTrafficForecastSnapshotSchema: z.ZodType<RoadTrafficForecastSnapshot> = z
  .object({
    forecastAt: z
      .number()
      .finite()
      .int()
      .nonnegative()
      .max(8_640_000_000_000_000)
      .safe()
      .refine((value) => value % 3_600_000 === 0, 'Road traffic forecast time must be hour-aligned'),
    sectionId: canonicalIdSchema,
    segments: z.array(roadTrafficForecastSegmentSchema).max(ROAD_TRAFFIC_FORECAST_MAX_SEGMENTS),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const identities = new Set<string>();
    for (const [index, segment] of snapshot.segments.entries()) {
      const identity = segmentIdentity(segment);
      if (identities.has(identity)) {
        context.addIssue({
          code: 'custom',
          message: 'Road traffic forecast segment identities must be unique',
          path: ['segments', index],
        });
      }
      identities.add(identity);

      const previous = snapshot.segments[index - 1];
      if (previous !== undefined && compareRoadTrafficForecastSegments(previous, segment) >= 0) {
        context.addIssue({
          code: 'custom',
          message: 'Road traffic forecast segments must use deterministic order',
          path: ['segments', index],
        });
      }
    }

    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > ROAD_TRAFFIC_FORECAST_MAX_SERIALIZED_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Road traffic forecast snapshot exceeds the serialized payload limit',
        path: [],
      });
    }
  });

export const roadTrafficForecastDataSchema = roadTrafficForecastSnapshotSchema;
