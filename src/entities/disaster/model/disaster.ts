import { z } from 'zod';

export const DISASTER_SOURCE = Object.freeze({
  label: '행정안전부 긴급재난문자',
  license: '공공누리 제4유형 기준 적용',
} as const);

const originalTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'Original provider text must not be blank');

const disasterAlertSchema = z
  .object({
    disasterType: originalTextSchema(100),
    emergencyStep: z.enum(['위급재난', '긴급재난', '안전안내']),
    id: z.string().regex(/^[1-9]\d{0,21}$/u),
    issuedAt: z.number().int().nonnegative().max(8_640_000_000_000_000).safe(),
    message: originalTextSchema(4_000),
    regionText: originalTextSchema(4_000),
  })
  .strict();

export const disasterSnapshotSchema = z
  .object({
    alerts: z.array(disasterAlertSchema).max(50),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = new Set<string>();
    for (const [index, alert] of snapshot.alerts.entries()) {
      if (ids.has(alert.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Disaster alert ids must be unique',
          path: ['alerts', index, 'id'],
        });
      }
      ids.add(alert.id);

      const previous = snapshot.alerts[index - 1];
      const previousIdComesBefore =
        previous !== undefined &&
        (previous.id.length > alert.id.length ||
          (previous.id.length === alert.id.length && previous.id.localeCompare(alert.id) >= 0));
      if (
        previous !== undefined &&
        (previous.issuedAt < alert.issuedAt || (previous.issuedAt === alert.issuedAt && !previousIdComesBefore))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Disaster alerts must use deterministic newest-first order',
          path: ['alerts', index],
        });
      }
    }
  });

export const disasterDataSchema = disasterSnapshotSchema;

export type DisasterSnapshot = z.infer<typeof disasterSnapshotSchema>;
export type DisasterAlert = DisasterSnapshot['alerts'][number];
export type DisasterEmergencyStep = DisasterAlert['emergencyStep'];
