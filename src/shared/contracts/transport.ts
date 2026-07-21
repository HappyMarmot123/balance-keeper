import { z } from 'zod';

const serverApiErrorCodes = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'UNPROCESSABLE_CONTENT',
  'RATE_LIMITED',
  'INTERNAL',
  'UPSTREAM_UNAVAILABLE',
  'MISSING_CREDENTIALS',
  'SERVICE_UNAVAILABLE',
] as const;

const clientApiErrorCodes = ['NETWORK_ERROR', 'INVALID_RESPONSE'] as const;

// Preserve sync schemas while letting the eager shared/api barrel tree-shake unused Zod contracts.
const createSchema = <Schema extends z.ZodType>(factory: () => Schema): Schema => factory();

export const serverApiErrorCodeSchema = /* @__PURE__ */ createSchema(() => z.enum(serverApiErrorCodes));
export const clientApiErrorCodeSchema = /* @__PURE__ */ createSchema(() => z.enum(clientApiErrorCodes));
export const apiErrorCodeSchema = /* @__PURE__ */ createSchema(() =>
  z.enum([...serverApiErrorCodes, ...clientApiErrorCodes]),
);
export const apiErrorStatusSchema = /* @__PURE__ */ createSchema(() =>
  z.union([z.literal(0), z.number().int().min(100).max(599)]),
);
export const cacheStatusSchema = /* @__PURE__ */ createSchema(() => z.enum(['MISS', 'HIT', 'STALE', 'REVALIDATED']));

const requestIdSchema = /* @__PURE__ */ createSchema(() => z.string().min(1));

export const errorFieldsSchema = /* @__PURE__ */ createSchema(() => z.record(z.string(), z.array(z.string())));

export const successMetaSchema = /* @__PURE__ */ createSchema(() =>
  z
    .object({
      cache: cacheStatusSchema,
      fetchedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      requestId: requestIdSchema,
      source: z.string().min(1),
    })
    .strict(),
);

export const errorEnvelopeSchema = /* @__PURE__ */ createSchema(() =>
  z
    .object({
      error: z
        .object({
          code: serverApiErrorCodeSchema,
          fields: errorFieldsSchema.optional(),
          requestId: requestIdSchema,
        })
        .strict(),
    })
    .strict(),
);

export const successEnvelopeSchema = <DataSchema extends z.ZodType>(dataSchema: DataSchema) =>
  z
    .object({
      data: dataSchema,
      meta: successMetaSchema,
    })
    .strict();

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorStatus = z.infer<typeof apiErrorStatusSchema>;
export type CacheStatus = z.infer<typeof cacheStatusSchema>;
export type ClientApiErrorCode = z.infer<typeof clientApiErrorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type ErrorFields = z.infer<typeof errorFieldsSchema>;
export type ServerApiErrorCode = z.infer<typeof serverApiErrorCodeSchema>;
export type SuccessEnvelope<DataSchema extends z.ZodType> = z.infer<
  ReturnType<typeof successEnvelopeSchema<DataSchema>>
>;
export type SuccessMeta = z.infer<typeof successMetaSchema>;
