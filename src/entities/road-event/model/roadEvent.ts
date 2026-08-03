import { z } from 'zod';

export const ROAD_EVENT_SEVERITY = 'provider-unspecified' as const;
export const ROAD_EVENT_MAX_EVENTS = 500;
export const ROAD_EVENT_MAX_ID_LENGTH = 128;
export const ROAD_EVENT_MAX_MESSAGE_LENGTH = 4_000;
export const ROAD_EVENT_MAX_GEOMETRY_POSITIONS = 2_000;
export const ROAD_EVENT_MAX_SERIALIZED_BYTES = 512 * 1024;

const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

export const roadEventCategorySchema = z.enum([
  'roadwork',
  'traffic-accident',
  'weather',
  'disaster',
  'flooding',
  'river-flood',
  'sinkhole',
  'wildfire',
  'other',
]);

export const roadEventLifecycleSchema = z.enum(['active', 'scheduled', 'unknown']);
export const roadEventChannelSchema = z.enum(['incidents', 'disasters']);

export type RoadEventCategory = z.infer<typeof roadEventCategorySchema>;
export type RoadEventLifecycle = z.infer<typeof roadEventLifecycleSchema>;
export type RoadEventChannel = z.infer<typeof roadEventChannelSchema>;
export type RoadEventPosition = readonly [longitude: number, latitude: number];

export type RoadEventGeometry =
  | Readonly<{ kind: 'point'; position: RoadEventPosition }>
  | Readonly<{ kind: 'line'; path: readonly RoadEventPosition[] }>
  | Readonly<{ kind: 'area'; ring: readonly RoadEventPosition[] }>;

export type RoadEvent = Readonly<{
  category: RoadEventCategory;
  endsAt: number | null;
  geometry: RoadEventGeometry;
  id: string;
  lifecycle: RoadEventLifecycle;
  message: string | null;
  severity: typeof ROAD_EVENT_SEVERITY;
  startsAt: number;
}>;

export type RoadEventSnapshot = Readonly<{
  channel: RoadEventChannel;
  events: readonly RoadEvent[];
  generatedAt: number;
}>;

const epochSchema = z.number().finite().int().nonnegative().max(MAX_DATE_EPOCH_MS).safe();
const coordinateSchema: z.ZodType<RoadEventPosition> = z.tuple([
  z.number().finite().min(124).max(132),
  z.number().finite().min(32).max(40),
]);

const pointGeometrySchema = z
  .object({
    kind: z.literal('point'),
    position: coordinateSchema,
  })
  .strict();

const countDistinctPositions = (positions: readonly RoadEventPosition[]): number =>
  new Set(positions.map(([longitude, latitude]) => `${longitude}\u0000${latitude}`)).size;

const lineGeometrySchema = z
  .object({
    kind: z.literal('line'),
    path: z.array(coordinateSchema).min(2).max(ROAD_EVENT_MAX_GEOMETRY_POSITIONS),
  })
  .strict()
  .superRefine((geometry, context) => {
    if (countDistinctPositions(geometry.path) < 2) {
      context.addIssue({
        code: 'custom',
        message: 'Road event line requires at least two distinct positions',
        path: ['path'],
      });
    }
  });

const areaGeometrySchema = z
  .object({
    kind: z.literal('area'),
    ring: z.array(coordinateSchema).min(3).max(ROAD_EVENT_MAX_GEOMETRY_POSITIONS),
  })
  .strict()
  .superRefine((geometry, context) => {
    if (countDistinctPositions(geometry.ring) < 3) {
      context.addIssue({
        code: 'custom',
        message: 'Road event area requires at least three distinct positions',
        path: ['ring'],
      });
    }
  });

export const roadEventGeometrySchema: z.ZodType<RoadEventGeometry> = z.discriminatedUnion('kind', [
  pointGeometrySchema,
  lineGeometrySchema,
  areaGeometrySchema,
]);

const canonicalIdSchema = z
  .string()
  .min(1)
  .max(ROAD_EVENT_MAX_ID_LENGTH)
  .refine((value) => value.trim().length > 0, 'Road event id must not be blank')
  .refine((value) => value === value.trim(), 'Road event id must be canonical');

const canonicalMessageSchema = z
  .string()
  .min(1)
  .max(ROAD_EVENT_MAX_MESSAGE_LENGTH)
  .refine((value) => value.trim().length > 0, 'Road event message must not be blank')
  .refine((value) => value === value.trim(), 'Road event message must be canonical');

export const roadEventSchema: z.ZodType<RoadEvent> = z
  .object({
    category: roadEventCategorySchema,
    endsAt: epochSchema.nullable(),
    geometry: roadEventGeometrySchema,
    id: canonicalIdSchema,
    lifecycle: roadEventLifecycleSchema,
    message: canonicalMessageSchema.nullable(),
    severity: z.literal(ROAD_EVENT_SEVERITY),
    startsAt: epochSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.endsAt !== null && event.endsAt <= event.startsAt) {
      context.addIssue({
        code: 'custom',
        message: 'Road event end time must follow its start time',
        path: ['endsAt'],
      });
    }
  });

const incidentCategories = new Set<RoadEventCategory>(['roadwork', 'traffic-accident', 'weather', 'disaster', 'other']);
const disasterCategories = new Set<RoadEventCategory>(['flooding', 'river-flood', 'sinkhole', 'wildfire']);

export const compareRoadEvents = (left: RoadEvent, right: RoadEvent): number => {
  if (left.startsAt !== right.startsAt) {
    return left.startsAt > right.startsAt ? -1 : 1;
  }
  if (left.id < right.id) {
    return -1;
  }
  return left.id > right.id ? 1 : 0;
};

export const roadEventSnapshotSchema: z.ZodType<RoadEventSnapshot> = z
  .object({
    channel: roadEventChannelSchema,
    events: z.array(roadEventSchema).max(ROAD_EVENT_MAX_EVENTS),
    generatedAt: epochSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = new Set<string>();
    const allowedCategories = snapshot.channel === 'incidents' ? incidentCategories : disasterCategories;

    for (const [index, event] of snapshot.events.entries()) {
      if (!allowedCategories.has(event.category)) {
        context.addIssue({
          code: 'custom',
          message: 'Road event category must match its snapshot channel',
          path: ['events', index, 'category'],
        });
      }

      if (snapshot.channel === 'disasters' && event.message === null) {
        context.addIssue({
          code: 'custom',
          message: 'Disaster road events require a message',
          path: ['events', index, 'message'],
        });
      }

      if (event.endsAt !== null && event.endsAt <= snapshot.generatedAt) {
        context.addIssue({
          code: 'custom',
          message: 'Road event snapshots must exclude ended events',
          path: ['events', index, 'endsAt'],
        });
      }

      const expectedLifecycle =
        event.startsAt > snapshot.generatedAt ? 'scheduled' : event.endsAt === null ? 'unknown' : 'active';
      if (event.lifecycle !== expectedLifecycle) {
        context.addIssue({
          code: 'custom',
          message: 'Road event lifecycle must match snapshot-relative event times',
          path: ['events', index, 'lifecycle'],
        });
      }

      if (ids.has(event.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Road event ids must be unique',
          path: ['events', index, 'id'],
        });
      }
      ids.add(event.id);

      const previous = snapshot.events[index - 1];
      if (previous !== undefined && compareRoadEvents(previous, event) >= 0) {
        context.addIssue({
          code: 'custom',
          message: 'Road events must use deterministic start-time and id order',
          path: ['events', index],
        });
      }
    }

    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > ROAD_EVENT_MAX_SERIALIZED_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Road event snapshot exceeds the serialized payload limit',
        path: [],
      });
    }
  });

export const roadEventDataSchema = roadEventSnapshotSchema;
