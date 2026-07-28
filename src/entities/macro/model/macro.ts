import { z } from 'zod';

export type MacroCycle = 'D' | 'M';
export type MacroSeriesId = 'usd-krw' | 'base-rate' | 'fx-reserves';

export type MacroSeriesDefinition = Readonly<{
  cycle: MacroCycle;
  displayUnit: string;
  id: MacroSeriesId;
  itemCode: string;
  label: string;
  sourceUnit: string;
  statCode: string;
}>;

export const MACRO_SERIES = Object.freeze([
  Object.freeze({
    cycle: 'D',
    displayUnit: '원',
    id: 'usd-krw',
    itemCode: '0000001',
    label: '원/미국달러',
    sourceUnit: '원',
    statCode: '731Y001',
  }),
  Object.freeze({
    cycle: 'D',
    displayUnit: '%',
    id: 'base-rate',
    itemCode: '0101000',
    label: '한국은행 기준금리',
    sourceUnit: '연%',
    statCode: '722Y001',
  }),
  Object.freeze({
    cycle: 'M',
    displayUnit: '억 달러',
    id: 'fx-reserves',
    itemCode: '99',
    label: '외환보유액',
    sourceUnit: '천달러',
    statCode: '732Y001',
  }),
] as const satisfies readonly MacroSeriesDefinition[]);

export const macroSeriesStatusSchema = z.enum(['available', 'empty', 'unavailable']);

const dailyPeriodSchema = z
  .string()
  .regex(/^\d{8}$/)
  .refine((period) => {
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(4, 6));
    const day = Number(period.slice(6, 8));
    const calendar = new Date(Date.UTC(year, month - 1, day));
    return (
      year >= 2000 &&
      calendar.getUTCFullYear() === year &&
      calendar.getUTCMonth() === month - 1 &&
      calendar.getUTCDate() === day
    );
  }, 'Daily macro period must be a valid calendar date');

const monthlyPeriodSchema = z
  .string()
  .regex(/^\d{6}$/)
  .refine((period) => {
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(4, 6));
    return year >= 2000 && month >= 1 && month <= 12;
  }, 'Monthly macro period must be a valid calendar month');

const createMacroSeriesSchema = <Definition extends (typeof MACRO_SERIES)[number]>(definition: Definition) => {
  const expectedScale = definition.id === 'fx-reserves' ? 100_000 : 1;
  const observationSchema = z
    .object({
      period: definition.cycle === 'D' ? dailyPeriodSchema : monthlyPeriodSchema,
      sourceValue: z.number().finite(),
      value: z.number().finite(),
    })
    .strict()
    .superRefine((observation, context) => {
      const expected = observation.sourceValue / expectedScale;
      if (Math.abs(observation.value - expected) > Number.EPSILON * Math.max(1, Math.abs(expected))) {
        context.addIssue({
          code: 'custom',
          message: 'Normalized macro value does not match its source value',
          path: ['value'],
        });
      }
    });

  return z
    .object({
      cycle: z.literal(definition.cycle),
      displayUnit: z.literal(definition.displayUnit),
      id: z.literal(definition.id),
      itemCode: z.literal(definition.itemCode),
      label: z.literal(definition.label),
      observation: observationSchema.nullable(),
      sourceUnit: z.literal(definition.sourceUnit),
      statCode: z.literal(definition.statCode),
      status: macroSeriesStatusSchema,
    })
    .strict()
    .superRefine((series, context) => {
      const hasObservation = series.observation !== null;
      if ((series.status === 'available') !== hasObservation) {
        context.addIssue({
          code: 'custom',
          message: 'Only an available macro series may contain an observation',
          path: ['observation'],
        });
      }
    });
};

export const macroSnapshotSchema = z
  .object({
    series: z.tuple([
      createMacroSeriesSchema(MACRO_SERIES[0]),
      createMacroSeriesSchema(MACRO_SERIES[1]),
      createMacroSeriesSchema(MACRO_SERIES[2]),
    ]),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.series.every((series) => series.status === 'unavailable')) {
      context.addIssue({
        code: 'custom',
        message: 'At least one macro series must have a provider result',
        path: ['series'],
      });
    }
  });

export const macroDataSchema = macroSnapshotSchema;

export type MacroSeriesStatus = z.infer<typeof macroSeriesStatusSchema>;
export type MacroSnapshot = z.infer<typeof macroSnapshotSchema>;
export type MacroSeries = MacroSnapshot['series'][number];
