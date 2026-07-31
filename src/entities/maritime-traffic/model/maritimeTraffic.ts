import { z } from 'zod';

export const MARITIME_TRAFFIC_MAX_CELLS = 5_000;
export const MARITIME_TRAFFIC_MAX_GRID_ID_LENGTH = 128;
export const MARITIME_TRAFFIC_MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;

export type MaritimeTrafficCell = Readonly<{
  densityPercent: number;
  gridId: string;
  vesselCount: number;
}>;

export type MaritimeTrafficSnapshot = Readonly<{
  cells: readonly MaritimeTrafficCell[];
  generatedAt: number;
}>;

const maritimeGridIdSchema = z
  .string()
  .min(1)
  .max(MARITIME_TRAFFIC_MAX_GRID_ID_LENGTH)
  .refine((gridId) => gridId.trim().length > 0, 'Maritime traffic grid id must not be blank')
  .refine((gridId) => gridId === gridId.trim(), 'Maritime traffic grid id must be canonical');

const maritimeTrafficCellSchema: z.ZodType<MaritimeTrafficCell> = z
  .object({
    densityPercent: z.number().finite().min(0).max(100),
    gridId: maritimeGridIdSchema,
    vesselCount: z.number().finite().int().nonnegative().safe(),
  })
  .strict();

export const maritimeTrafficSnapshotSchema: z.ZodType<MaritimeTrafficSnapshot> = z
  .object({
    cells: z.array(maritimeTrafficCellSchema).max(MARITIME_TRAFFIC_MAX_CELLS),
    generatedAt: z.number().finite().int().nonnegative().max(8_640_000_000_000_000).safe(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const gridIds = new Set<string>();
    for (const [index, cell] of snapshot.cells.entries()) {
      if (gridIds.has(cell.gridId)) {
        context.addIssue({
          code: 'custom',
          message: 'Maritime traffic grid ids must be unique',
          path: ['cells', index, 'gridId'],
        });
      }
      gridIds.add(cell.gridId);

      const previous = snapshot.cells[index - 1];
      if (previous !== undefined && previous.gridId >= cell.gridId) {
        context.addIssue({
          code: 'custom',
          message: 'Maritime traffic cells must use deterministic ascending grid id order',
          path: ['cells', index, 'gridId'],
        });
      }
    }

    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MARITIME_TRAFFIC_MAX_SERIALIZED_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Maritime traffic snapshot exceeds the serialized payload limit',
        path: [],
      });
    }
  });

export const maritimeTrafficDataSchema = maritimeTrafficSnapshotSchema;
