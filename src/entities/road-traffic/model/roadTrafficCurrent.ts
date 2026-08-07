import { z } from 'zod';

export const ROAD_TRAFFIC_CURRENT_SPEED_UNIT = 'provider-unspecified' as const;
export const ROAD_TRAFFIC_CURRENT_MAX_BBOX_SPAN_DEGREES = 0.1;
export const ROAD_TRAFFIC_CURRENT_MAX_SEGMENTS = 10_000;
export const ROAD_TRAFFIC_CURRENT_MAX_SERIALIZED_BYTES = 2 * 1_024 * 1_024;
export const ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH = 64;

export const ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS = Object.freeze({
  maximumLatitude: 40,
  maximumLongitude: 132,
  minimumLatitude: 32,
  minimumLongitude: 124,
});

const canonicalCoordinateSchema = (minimum: number, maximum: number) =>
  z
    .number()
    .finite()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === Number(value.toFixed(4)), 'Road traffic bounds must use at most four decimals');

export const roadTrafficCurrentBoundsSchema = z
  .object({
    maximumLatitude: canonicalCoordinateSchema(
      ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS.minimumLatitude,
      ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS.maximumLatitude,
    ),
    maximumLongitude: canonicalCoordinateSchema(
      ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS.minimumLongitude,
      ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS.maximumLongitude,
    ),
    minimumLatitude: canonicalCoordinateSchema(
      ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS.minimumLatitude,
      ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS.maximumLatitude,
    ),
    minimumLongitude: canonicalCoordinateSchema(
      ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS.minimumLongitude,
      ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS.maximumLongitude,
    ),
  })
  .strict()
  .superRefine((bounds, context) => {
    if (bounds.minimumLatitude >= bounds.maximumLatitude) {
      context.addIssue({ code: 'custom', message: 'Road traffic latitude bounds must be ordered' });
    }
    if (bounds.minimumLongitude >= bounds.maximumLongitude) {
      context.addIssue({ code: 'custom', message: 'Road traffic longitude bounds must be ordered' });
    }
    if (
      Number((bounds.maximumLatitude - bounds.minimumLatitude).toFixed(4)) > ROAD_TRAFFIC_CURRENT_MAX_BBOX_SPAN_DEGREES
    ) {
      context.addIssue({ code: 'custom', message: 'Road traffic latitude span exceeds the product limit' });
    }
    if (
      Number((bounds.maximumLongitude - bounds.minimumLongitude).toFixed(4)) >
      ROAD_TRAFFIC_CURRENT_MAX_BBOX_SPAN_DEGREES
    ) {
      context.addIssue({ code: 'custom', message: 'Road traffic longitude span exceeds the product limit' });
    }
  });

export type RoadTrafficCurrentBounds = z.infer<typeof roadTrafficCurrentBoundsSchema>;

const looseBoundsSchema = z
  .object({
    maximumLatitude: z.number().finite(),
    maximumLongitude: z.number().finite(),
    minimumLatitude: z.number().finite(),
    minimumLongitude: z.number().finite(),
  })
  .strict();

export const canonicalizeRoadTrafficCurrentBounds = (input: RoadTrafficCurrentBounds): RoadTrafficCurrentBounds => {
  const bounds = looseBoundsSchema.parse(input);
  return roadTrafficCurrentBoundsSchema.parse({
    maximumLatitude: Number(bounds.maximumLatitude.toFixed(4)),
    maximumLongitude: Number(bounds.maximumLongitude.toFixed(4)),
    minimumLatitude: Number(bounds.minimumLatitude.toFixed(4)),
    minimumLongitude: Number(bounds.minimumLongitude.toFixed(4)),
  });
};

const canonicalIdSchema = z
  .string()
  .min(1)
  .max(ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH)
  .refine((value) => value === value.trim(), 'Road traffic identifiers must be canonical');
const nullableProviderTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), 'Road traffic labels must be canonical')
    .nullable();

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

export type RoadTrafficCurrentSegment = Readonly<{
  directionCode: string | null;
  endNodeId: string | null;
  linkId: string;
  observedAtSource: string;
  roadName: string | null;
  speed: number;
  speedUnit: typeof ROAD_TRAFFIC_CURRENT_SPEED_UNIT;
  startNodeId: string | null;
  travelTimeSeconds: number;
}>;

const roadTrafficCurrentSegmentSchema: z.ZodType<RoadTrafficCurrentSegment> = z
  .object({
    directionCode: nullableProviderTextSchema(64),
    endNodeId: canonicalIdSchema.nullable(),
    linkId: canonicalIdSchema,
    observedAtSource: z.string().refine(isValidSourceTimestamp, 'Road traffic source timestamp is invalid'),
    roadName: nullableProviderTextSchema(200),
    speed: z.number().finite().min(0).max(300),
    speedUnit: z.literal(ROAD_TRAFFIC_CURRENT_SPEED_UNIT),
    startNodeId: canonicalIdSchema.nullable(),
    travelTimeSeconds: z.number().finite().min(0).max(86_400),
  })
  .strict();

export const compareRoadTrafficCurrentSegments = (
  left: RoadTrafficCurrentSegment,
  right: RoadTrafficCurrentSegment,
): number => (left.linkId < right.linkId ? -1 : left.linkId > right.linkId ? 1 : 0);

export type RoadTrafficCurrentSnapshot = Readonly<{
  bounds: RoadTrafficCurrentBounds;
  segments: readonly RoadTrafficCurrentSegment[];
}>;

export const roadTrafficCurrentSnapshotSchema: z.ZodType<RoadTrafficCurrentSnapshot> = z
  .object({
    bounds: roadTrafficCurrentBoundsSchema,
    segments: z.array(roadTrafficCurrentSegmentSchema).max(ROAD_TRAFFIC_CURRENT_MAX_SEGMENTS),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const identities = new Set<string>();
    for (const [index, segment] of snapshot.segments.entries()) {
      if (identities.has(segment.linkId)) {
        context.addIssue({
          code: 'custom',
          message: 'Road traffic current link identifiers must be unique',
          path: ['segments', index, 'linkId'],
        });
      }
      identities.add(segment.linkId);
      const previous = snapshot.segments[index - 1];
      if (previous !== undefined && compareRoadTrafficCurrentSegments(previous, segment) >= 0) {
        context.addIssue({
          code: 'custom',
          message: 'Road traffic current segments must use deterministic order',
          path: ['segments', index],
        });
      }
    }

    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > ROAD_TRAFFIC_CURRENT_MAX_SERIALIZED_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Road traffic current snapshot exceeds the serialized payload limit',
        path: [],
      });
    }
  });

export const roadTrafficCurrentDataSchema = roadTrafficCurrentSnapshotSchema;
