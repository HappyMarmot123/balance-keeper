import { z } from 'zod';

import type { SuccessEnvelope } from '../../../shared/contracts';

const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

export const WEATHER_ALERT_SOURCE = Object.freeze({
  label: '기상청 기상특보',
  license: '공공누리 제1유형',
} as const);

export const weatherAlertKindSchema = z.enum([
  'strong-wind',
  'heavy-rain',
  'cold-wave',
  'dry',
  'storm-surge',
  'high-waves',
  'typhoon',
  'heavy-snow',
  'yellow-dust',
  'heat-wave',
  'tropical-night',
  'unknown',
]);

export const weatherAlertLevelSchema = z.enum(['advisory', 'warning', 'emergency-warning', 'unknown']);

export const weatherAlertCommandSchema = z.enum(['issue', 'extend', 'correction', 'change-issue']);

export const WEATHER_ALERT_KIND_BY_CODE = Object.freeze({
  1: 'strong-wind',
  2: 'heavy-rain',
  3: 'cold-wave',
  4: 'dry',
  5: 'storm-surge',
  6: 'high-waves',
  7: 'typhoon',
  8: 'heavy-snow',
  9: 'yellow-dust',
  12: 'heat-wave',
  13: 'tropical-night',
} as const);

export const WEATHER_ALERT_LEVEL_BY_CODE = Object.freeze({
  0: 'advisory',
  1: 'warning',
  2: 'emergency-warning',
} as const);

export const WEATHER_ALERT_COMMAND_BY_CODE = Object.freeze({
  1: 'issue',
  3: 'extend',
  6: 'correction',
  7: 'change-issue',
} as const);

const epochSchema = z.number().int().nonnegative().max(MAX_DATE_EPOCH_MS).safe();
const providerTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'Provider text must not be blank');

export const weatherAlertSchema = z
  .object({
    areaCode: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/u),
    areaName: providerTextSchema(100),
    command: weatherAlertCommandSchema,
    commandCode: z.number().int().min(1).max(9),
    effectiveAt: epochSchema,
    endsAt: epochSchema.nullable(),
    id: z.string().regex(/^\d{12}-\d{1,4}-[A-Z][A-Z0-9]{1,9}-\d{1,2}$/u),
    issuedAt: epochSchema,
    kind: weatherAlertKindSchema,
    kindCode: z.number().int().min(1).max(99),
    level: weatherAlertLevelSchema,
    levelCode: z.number().int().min(0).max(9),
  })
  .strict()
  .superRefine((alert, context) => {
    if (alert.effectiveAt < alert.issuedAt) {
      context.addIssue({
        code: 'custom',
        message: 'Weather alert effective time must not precede its issue time',
        path: ['effectiveAt'],
      });
    }

    if (alert.endsAt !== null && alert.endsAt < alert.effectiveAt) {
      context.addIssue({
        code: 'custom',
        message: 'Weather alert end time must not precede its effective time',
        path: ['endsAt'],
      });
    }

    const expectedKind = WEATHER_ALERT_KIND_BY_CODE[alert.kindCode as keyof typeof WEATHER_ALERT_KIND_BY_CODE];
    if ((expectedKind ?? 'unknown') !== alert.kind) {
      context.addIssue({
        code: 'custom',
        message: 'Weather alert kind must match its provider code',
        path: ['kind'],
      });
    }

    const expectedLevel = WEATHER_ALERT_LEVEL_BY_CODE[alert.levelCode as keyof typeof WEATHER_ALERT_LEVEL_BY_CODE];
    if ((expectedLevel ?? 'unknown') !== alert.level) {
      context.addIssue({
        code: 'custom',
        message: 'Weather alert level must match its provider code',
        path: ['level'],
      });
    }

    const expectedCommand =
      WEATHER_ALERT_COMMAND_BY_CODE[alert.commandCode as keyof typeof WEATHER_ALERT_COMMAND_BY_CODE];
    if (expectedCommand !== alert.command) {
      context.addIssue({
        code: 'custom',
        message: 'Weather alert command must match its provider code',
        path: ['command'],
      });
    }
  });

export const weatherAlertBulletinSchema = z.discriminatedUnion('availability', [
  z
    .object({
      availability: z.literal('available'),
      details: providerTextSchema(4_000).nullable(),
      issuedAt: epochSchema,
      title: providerTextSchema(500),
    })
    .strict(),
  z.object({ availability: z.literal('unavailable') }).strict(),
]);

const levelPriority: Record<z.infer<typeof weatherAlertLevelSchema>, number> = {
  'emergency-warning': 0,
  warning: 1,
  advisory: 2,
  unknown: 3,
};

export const weatherAlertSnapshotSchema = z
  .object({
    alerts: z.array(weatherAlertSchema).min(1).max(100),
    bulletin: weatherAlertBulletinSchema,
    statusEffectiveAt: epochSchema,
    statusIssuedAt: epochSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.statusEffectiveAt < snapshot.statusIssuedAt) {
      context.addIssue({
        code: 'custom',
        message: 'Weather alert status effective time must not precede its issue time',
        path: ['statusEffectiveAt'],
      });
    }

    const ids = new Set<string>();
    const activeAreaKinds = new Set<string>();
    for (const [index, alert] of snapshot.alerts.entries()) {
      if (ids.has(alert.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Weather alert ids must be unique',
          path: ['alerts', index, 'id'],
        });
      }
      ids.add(alert.id);

      const activeAreaKind = `${alert.areaCode}:${alert.kindCode}`;
      if (activeAreaKinds.has(activeAreaKind)) {
        context.addIssue({
          code: 'custom',
          message: 'Weather alert active area-kind pairs must be unique',
          path: ['alerts', index],
        });
      }
      activeAreaKinds.add(activeAreaKind);

      const previous = snapshot.alerts[index - 1];
      if (previous === undefined) {
        continue;
      }
      const previousPriority = levelPriority[previous.level];
      const currentPriority = levelPriority[alert.level];
      const incorrectlyOrdered =
        currentPriority < previousPriority ||
        (currentPriority === previousPriority && alert.effectiveAt > previous.effectiveAt) ||
        (currentPriority === previousPriority &&
          alert.effectiveAt === previous.effectiveAt &&
          alert.id.localeCompare(previous.id) <= 0);
      if (incorrectlyOrdered) {
        context.addIssue({
          code: 'custom',
          message: 'Weather alerts must use deterministic severity and effective-time order',
          path: ['alerts', index],
        });
      }
    }
  });

export const weatherAlertDataSchema = weatherAlertSnapshotSchema.nullable();

export type WeatherAlert = z.infer<typeof weatherAlertSchema>;
export type WeatherAlertBulletin = z.infer<typeof weatherAlertBulletinSchema>;
export type WeatherAlertCommand = z.infer<typeof weatherAlertCommandSchema>;
export type WeatherAlertData = z.infer<typeof weatherAlertDataSchema>;
export type WeatherAlertEnvelope = SuccessEnvelope<typeof weatherAlertDataSchema>;
export type WeatherAlertKind = z.infer<typeof weatherAlertKindSchema>;
export type WeatherAlertLevel = z.infer<typeof weatherAlertLevelSchema>;
export type WeatherAlertSnapshot = z.infer<typeof weatherAlertSnapshotSchema>;
