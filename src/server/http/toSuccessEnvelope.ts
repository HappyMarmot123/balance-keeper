import type { z } from 'zod';

import { type SuccessEnvelope, type SuccessMeta, successEnvelopeSchema } from '../../shared/contracts';

export function toSuccessEnvelope<DataSchema extends z.ZodType>(
  dataSchema: DataSchema,
  data: z.input<DataSchema>,
  meta: SuccessMeta,
): SuccessEnvelope<DataSchema> {
  return successEnvelopeSchema(dataSchema).parse({ data, meta });
}
