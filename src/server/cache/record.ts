import { z } from 'zod';

export type PositiveCacheRecord<Data> = Readonly<{
  version: 1;
  kind: 'positive';
  data: Data;
  source: string;
  fetchedAt: number;
  storedAt: number;
  freshUntil: number;
  staleUntil: number;
}>;

export type NegativeCacheRecord<Data> = Readonly<{
  version: 1;
  kind: 'negative';
  data: Data;
  source: string;
  fetchedAt: number;
  storedAt: number;
  freshUntil: number;
}>;

export type CacheRecord<Data> = PositiveCacheRecord<Data> | NegativeCacheRecord<Data>;

export type CacheRecordClassification<RecordType> =
  | Readonly<{ state: 'fresh'; record: RecordType }>
  | Readonly<{ state: 'stale'; record: RecordType }>
  | Readonly<{ state: 'expired'; record: RecordType }>
  | Readonly<{ state: 'invalid' }>;

export type CacheRecordSchema<Data> = z.ZodType<CacheRecord<Data>>;

const epochMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export function createCacheRecordSchema<DataSchema extends z.ZodType>(
  dataSchema: DataSchema,
): CacheRecordSchema<z.output<DataSchema>> {
  const commonShape = {
    version: z.literal(1),
    data: dataSchema,
    source: z.string().min(1),
    fetchedAt: epochMillisecondsSchema,
    storedAt: epochMillisecondsSchema,
    freshUntil: epochMillisecondsSchema,
  };

  return z
    .discriminatedUnion('kind', [
      z.strictObject({
        ...commonShape,
        kind: z.literal('positive'),
        staleUntil: epochMillisecondsSchema,
      }),
      z.strictObject({
        ...commonShape,
        kind: z.literal('negative'),
      }),
    ])
    .superRefine((record, context) => {
      if (record.freshUntil < record.storedAt) {
        context.addIssue({
          code: 'custom',
          path: ['freshUntil'],
          message: 'freshUntil must not precede storedAt',
        });
      }

      if ('staleUntil' in record && typeof record.staleUntil === 'number' && record.staleUntil < record.freshUntil) {
        context.addIssue({
          code: 'custom',
          path: ['staleUntil'],
          message: 'staleUntil must not precede freshUntil',
        });
      }
    }) as unknown as CacheRecordSchema<z.output<DataSchema>>;
}

const isEpochMilliseconds = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

export function classifyCacheRecord<Data>(
  recordSchema: CacheRecordSchema<Data>,
  input: unknown,
  now: number,
): CacheRecordClassification<CacheRecord<Data>> {
  if (!isEpochMilliseconds(now)) {
    throw new RangeError('Current time must be a non-negative safe epoch millisecond value');
  }

  const parsed = recordSchema.safeParse(input);

  if (!parsed.success) {
    return { state: 'invalid' };
  }

  const record = parsed.data;

  if (now < record.freshUntil) {
    return { state: 'fresh', record };
  }

  if (record.kind === 'positive' && now < record.staleUntil) {
    return { state: 'stale', record };
  }

  return { state: 'expired', record };
}
