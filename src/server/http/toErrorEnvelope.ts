import {
  type ApiErrorStatus,
  type ErrorEnvelope,
  errorEnvelopeSchema,
  isAppError,
  serverApiErrorCodeSchema,
  statusForApiErrorCode,
} from '../../shared/contracts';

export type SerializedApiError = Readonly<{
  envelope: ErrorEnvelope;
  status: ApiErrorStatus;
}>;

const createInternalError = (requestId: string): SerializedApiError => ({
  envelope: errorEnvelopeSchema.parse({
    error: { code: 'INTERNAL', requestId },
  }),
  status: 500,
});

export function toErrorEnvelope(error: unknown, requestId: string): SerializedApiError {
  if (!isAppError(error) || !serverApiErrorCodeSchema.safeParse(error.code).success) {
    return createInternalError(requestId);
  }

  const parsedEnvelope = errorEnvelopeSchema.safeParse({
    error: {
      code: error.code,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
      requestId,
    },
  });

  if (!parsedEnvelope.success) {
    return createInternalError(requestId);
  }

  return {
    envelope: parsedEnvelope.data,
    status: statusForApiErrorCode(parsedEnvelope.data.error.code),
  };
}
