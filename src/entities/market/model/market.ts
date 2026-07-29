import { z } from 'zod';

export type MarketIndexId = 'kospi' | 'kosdaq';
export type MarketIndexStatus = 'available' | 'empty' | 'unavailable';

export type MarketIndexDefinition = Readonly<{
  displayUnit: 'pt';
  id: MarketIndexId;
  label: string;
  providerName: string;
}>;

export const MARKET_INDEXES = Object.freeze([
  Object.freeze({
    displayUnit: 'pt',
    id: 'kospi',
    label: 'KOSPI',
    providerName: '코스피',
  }),
  Object.freeze({
    displayUnit: 'pt',
    id: 'kosdaq',
    label: 'KOSDAQ',
    providerName: '코스닥',
  }),
] as const satisfies readonly MarketIndexDefinition[]);

export const marketIndexStatusSchema = z.enum(['available', 'empty', 'unavailable']);

const marketDateSchema = z
  .string()
  .regex(/^\d{8}$/)
  .refine((date) => {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(4, 6));
    const day = Number(date.slice(6, 8));
    const calendar = new Date(Date.UTC(year, month - 1, day));
    return (
      year >= 2020 &&
      calendar.getUTCFullYear() === year &&
      calendar.getUTCMonth() === month - 1 &&
      calendar.getUTCDate() === day
    );
  }, 'Market observation date must be a valid calendar date');

const hasConsistentDirection = (change: number, changePercent: number): boolean =>
  !((change > 0 && changePercent < 0) || (change < 0 && changePercent > 0) || (change === 0 && changePercent !== 0));

const marketObservationSchema = z
  .object({
    change: z.number().finite(),
    changePercent: z.number().finite(),
    close: z.number().finite().positive(),
    date: marketDateSchema,
  })
  .strict()
  .refine((observation) => hasConsistentDirection(observation.change, observation.changePercent), {
    message: 'Market change and change percent must have a consistent direction',
    path: ['changePercent'],
  });

const createMarketIndexSchema = <Definition extends (typeof MARKET_INDEXES)[number]>(definition: Definition) =>
  z
    .object({
      displayUnit: z.literal(definition.displayUnit),
      id: z.literal(definition.id),
      label: z.literal(definition.label),
      observation: marketObservationSchema.nullable(),
      providerName: z.literal(definition.providerName),
      status: marketIndexStatusSchema,
    })
    .strict()
    .superRefine((index, context) => {
      const hasObservation = index.observation !== null;
      if ((index.status === 'available') !== hasObservation) {
        context.addIssue({
          code: 'custom',
          message: 'Only an available market index may contain an observation',
          path: ['observation'],
        });
      }
    });

export const marketSnapshotSchema = z
  .object({
    indices: z.tuple([createMarketIndexSchema(MARKET_INDEXES[0]), createMarketIndexSchema(MARKET_INDEXES[1])]),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.indices.every((index) => index.status === 'unavailable')) {
      context.addIssue({
        code: 'custom',
        message: 'At least one market index must have a provider result',
        path: ['indices'],
      });
    }
  });

export const marketDataSchema = marketSnapshotSchema;

export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;
export type MarketIndex = MarketSnapshot['indices'][number];
