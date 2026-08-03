import { z } from 'zod';

export const ROAD_GUIDANCE_TIME_BASIS = 'provider-local-unspecified' as const;
export const ROAD_GUIDANCE_SPEED_UNIT = 'provider-unspecified' as const;
export const ROAD_GUIDANCE_RESTRICTION_STATE = 'provider-unspecified' as const;
export const ROAD_GUIDANCE_MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;
export const VMS_GUIDANCE_MAX_ITEMS = 2_500;
export const SAFETY_NOTICE_MAX_ITEMS = 2_500;
export const VARIABLE_SPEED_LIMIT_MAX_ITEMS = 5_000;
export const VMS_GUIDANCE_MAX_PAGES = 16;
export const VMS_GUIDANCE_MAX_LINES_PER_PAGE = 8;
export const VMS_GUIDANCE_MAX_LINE_LENGTH = 512;
export const SAFETY_NOTICE_MAX_MESSAGE_LENGTH = 4_000;

const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;
const HASH_PATTERN = '[A-Za-z0-9_-]{32}';

export type RoadGuidancePosition = readonly [longitude: number, latitude: number];

export type VmsGuidancePage = Readonly<{
  lines: readonly string[];
  order: number;
}>;

export type VmsGuidanceItem = Readonly<{
  id: string;
  pages: readonly VmsGuidancePage[];
  position: RoadGuidancePosition;
  sourceTimestamp: string;
  timeBasis: typeof ROAD_GUIDANCE_TIME_BASIS;
}>;

export type VmsGuidanceSnapshot = Readonly<{
  channel: 'vms';
  generatedAt: number;
  items: readonly VmsGuidanceItem[];
}>;

export type SafetyNoticeItem = Readonly<{
  id: string;
  message: string;
  position: RoadGuidancePosition;
  providerPriorityCode: number;
  providerStepCode: number;
  providerType: string;
}>;

export type SafetyNoticeSnapshot = Readonly<{
  channel: 'safety-notices';
  generatedAt: number;
  items: readonly SafetyNoticeItem[];
}>;

export type VariableSpeedLimitItem = Readonly<{
  defaultLimitSpeed: number;
  id: string;
  limitSpeed: number;
  linkId: string | null;
  position: RoadGuidancePosition;
  restrictionState: typeof ROAD_GUIDANCE_RESTRICTION_STATE;
  roadClass: 'expressway' | 'national-road';
  roadNumber: string;
  sourceCreatedTimestamp: string;
  sourceRegisteredTimestamp: string;
  speedUnit: typeof ROAD_GUIDANCE_SPEED_UNIT;
  timeBasis: typeof ROAD_GUIDANCE_TIME_BASIS;
}>;

export type VariableSpeedLimitSnapshot = Readonly<{
  channel: 'variable-speed-limits';
  generatedAt: number;
  items: readonly VariableSpeedLimitItem[];
}>;

export type RoadGuidanceSnapshot = VmsGuidanceSnapshot | SafetyNoticeSnapshot | VariableSpeedLimitSnapshot;

const epochSchema = z.number().finite().int().nonnegative().max(MAX_DATE_EPOCH_MS).safe();

export const roadGuidancePositionSchema: z.ZodType<RoadGuidancePosition> = z.tuple([
  z.number().finite().min(124).max(132),
  z.number().finite().min(32).max(40),
]);

const isValidSourceTimestamp = (value: string): boolean => {
  if (!/^\d{14}$/u.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const instant = new Date(0);
  instant.setUTCHours(hour, minute, second, 0);
  instant.setUTCFullYear(year, month - 1, day);
  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() + 1 === month &&
    instant.getUTCDate() === day &&
    instant.getUTCHours() === hour &&
    instant.getUTCMinutes() === minute &&
    instant.getUTCSeconds() === second
  );
};

const hasUnsafePlainText = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      character === '<' ||
      character === '>' ||
      character === '|' ||
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
};

export const roadGuidanceSourceTimestampSchema = z
  .string()
  .length(14)
  .refine(isValidSourceTimestamp, 'Road guidance source timestamp must be a valid local calendar value');

const canonicalTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), 'Road guidance text must be canonical')
    .refine((value) => value === value.normalize('NFC'), 'Road guidance text must be normalized')
    .refine((value) => !hasUnsafePlainText(value), 'Road guidance text must be plain');

const hashedIdSchema = (channel: 'safety-notice' | 'vms' | 'vsl') =>
  z.string().regex(new RegExp(`^its-road-guidance:${channel}:${HASH_PATTERN}$`, 'u'));

export const vmsGuidancePageSchema: z.ZodType<VmsGuidancePage> = z
  .object({
    lines: z.array(canonicalTextSchema(VMS_GUIDANCE_MAX_LINE_LENGTH)).max(VMS_GUIDANCE_MAX_LINES_PER_PAGE),
    order: z.number().int().min(1).max(VMS_GUIDANCE_MAX_PAGES).safe(),
  })
  .strict();

const vmsPagesSchema = z
  .array(vmsGuidancePageSchema)
  .min(1)
  .max(VMS_GUIDANCE_MAX_PAGES)
  .superRefine((pages, context) => {
    for (const [index, page] of pages.entries()) {
      if (page.order !== index + 1) {
        context.addIssue({
          code: 'custom',
          message: 'VMS guidance page order must be unique, contiguous and start at one',
          path: [index, 'order'],
        });
      }
    }
  });

export const vmsGuidanceItemSchema: z.ZodType<VmsGuidanceItem> = z
  .object({
    id: hashedIdSchema('vms'),
    pages: vmsPagesSchema,
    position: roadGuidancePositionSchema,
    sourceTimestamp: roadGuidanceSourceTimestampSchema,
    timeBasis: z.literal(ROAD_GUIDANCE_TIME_BASIS),
  })
  .strict();

const providerCodeSchema = z.number().finite().int().nonnegative().max(9_999).safe();

export const safetyNoticeItemSchema: z.ZodType<SafetyNoticeItem> = z
  .object({
    id: hashedIdSchema('safety-notice'),
    message: canonicalTextSchema(SAFETY_NOTICE_MAX_MESSAGE_LENGTH),
    position: roadGuidancePositionSchema,
    providerPriorityCode: providerCodeSchema,
    providerStepCode: providerCodeSchema,
    providerType: canonicalTextSchema(128),
  })
  .strict();

const canonicalIdentifierSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), 'Road guidance identifier must be canonical');

export const variableSpeedLimitItemSchema: z.ZodType<VariableSpeedLimitItem> = z
  .object({
    defaultLimitSpeed: z.number().finite().int().min(0).max(300).safe(),
    id: hashedIdSchema('vsl'),
    limitSpeed: z.number().finite().int().min(0).max(300).safe(),
    linkId: canonicalIdentifierSchema(128).nullable(),
    position: roadGuidancePositionSchema,
    restrictionState: z.literal(ROAD_GUIDANCE_RESTRICTION_STATE),
    roadClass: z.enum(['expressway', 'national-road']),
    roadNumber: canonicalIdentifierSchema(64),
    sourceCreatedTimestamp: roadGuidanceSourceTimestampSchema,
    sourceRegisteredTimestamp: roadGuidanceSourceTimestampSchema,
    speedUnit: z.literal(ROAD_GUIDANCE_SPEED_UNIT),
    timeBasis: z.literal(ROAD_GUIDANCE_TIME_BASIS),
  })
  .strict();

const validateSnapshot = <Item extends Readonly<{ id: string }>>(
  snapshot: Readonly<{ items: readonly Item[] }>,
  context: z.RefinementCtx,
): void => {
  for (const [index, item] of snapshot.items.entries()) {
    const previous = snapshot.items[index - 1];
    if (previous !== undefined && previous.id >= item.id) {
      context.addIssue({
        code: 'custom',
        message: 'Road guidance items must have unique IDs in deterministic ascending order',
        path: ['items', index, 'id'],
      });
    }
  }

  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > ROAD_GUIDANCE_MAX_SERIALIZED_BYTES) {
    context.addIssue({
      code: 'custom',
      message: 'Road guidance snapshot exceeds the serialized payload limit',
      path: [],
    });
  }
};

export const vmsGuidanceSnapshotSchema: z.ZodType<VmsGuidanceSnapshot> = z
  .object({
    channel: z.literal('vms'),
    generatedAt: epochSchema,
    items: z.array(vmsGuidanceItemSchema).max(VMS_GUIDANCE_MAX_ITEMS),
  })
  .strict()
  .superRefine(validateSnapshot);

export const safetyNoticeSnapshotSchema: z.ZodType<SafetyNoticeSnapshot> = z
  .object({
    channel: z.literal('safety-notices'),
    generatedAt: epochSchema,
    items: z.array(safetyNoticeItemSchema).max(SAFETY_NOTICE_MAX_ITEMS),
  })
  .strict()
  .superRefine(validateSnapshot);

export const variableSpeedLimitSnapshotSchema: z.ZodType<VariableSpeedLimitSnapshot> = z
  .object({
    channel: z.literal('variable-speed-limits'),
    generatedAt: epochSchema,
    items: z.array(variableSpeedLimitItemSchema).max(VARIABLE_SPEED_LIMIT_MAX_ITEMS),
  })
  .strict()
  .superRefine(validateSnapshot);

export const roadGuidanceSnapshotSchema: z.ZodType<RoadGuidanceSnapshot> = z.union([
  vmsGuidanceSnapshotSchema,
  safetyNoticeSnapshotSchema,
  variableSpeedLimitSnapshotSchema,
]);

export const vmsGuidanceDataSchema = vmsGuidanceSnapshotSchema;
export const safetyNoticeDataSchema = safetyNoticeSnapshotSchema;
export const variableSpeedLimitDataSchema = variableSpeedLimitSnapshotSchema;
