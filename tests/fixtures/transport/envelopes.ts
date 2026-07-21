export const serverApiErrorCodes = [
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

export const clientApiErrorCodes = ['NETWORK_ERROR', 'INVALID_RESPONSE'] as const;

export const validSuccessEnvelopeFixture = {
  data: {
    signalCount: 3,
  },
  meta: {
    cache: 'MISS',
    fetchedAt: 1_721_520_000_000,
    requestId: 'req-success-1',
    source: 'fixture-source',
  },
} as const;

export const successEnvelopeBoundaryFixtures = [
  {
    name: 'zero epoch milliseconds',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, fetchedAt: 0 },
    },
  },
  {
    name: 'largest safe epoch integer',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, fetchedAt: Number.MAX_SAFE_INTEGER },
    },
  },
] as const;

export const malformedSuccessEnvelopeFixtures = [
  {
    name: 'unknown cache state',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, cache: 'CACHED' },
    },
  },
  {
    name: 'negative epoch milliseconds',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, fetchedAt: -1 },
    },
  },
  {
    name: 'fractional epoch milliseconds',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, fetchedAt: 1.5 },
    },
  },
  {
    name: 'unsafe epoch integer',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, fetchedAt: Number.MAX_SAFE_INTEGER + 1 },
    },
  },
  {
    name: 'extra envelope property',
    value: { ...validSuccessEnvelopeFixture, raw: 'must-not-cross-the-boundary' },
  },
  {
    name: 'extra metadata property',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, ttl: 60 },
    },
  },
  {
    name: 'empty success request id',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, requestId: '' },
    },
  },
  {
    name: 'empty source id',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: { ...validSuccessEnvelopeFixture.meta, source: '' },
    },
  },
  {
    name: 'missing fetchedAt metadata',
    value: {
      ...validSuccessEnvelopeFixture,
      meta: {
        cache: validSuccessEnvelopeFixture.meta.cache,
        requestId: validSuccessEnvelopeFixture.meta.requestId,
        source: validSuccessEnvelopeFixture.meta.source,
      },
    },
  },
  {
    name: 'mixed success and error envelope',
    value: {
      ...validSuccessEnvelopeFixture,
      error: { code: 'INTERNAL', requestId: 'req-mixed-success' },
    },
  },
] as const;

export const validErrorEnvelopeFixture = {
  error: {
    code: 'UNPROCESSABLE_CONTENT',
    fields: {
      bbox: ['must contain four finite coordinates'],
    },
    requestId: 'req-error-1',
  },
} as const;

export const malformedErrorEnvelopeFixtures = [
  {
    name: 'client-only code',
    value: {
      error: { code: 'NETWORK_ERROR', requestId: 'req-error-2' },
    },
  },
  {
    name: 'empty request id',
    value: {
      error: { code: 'BAD_REQUEST', requestId: '' },
    },
  },
  {
    name: 'human-readable message',
    value: {
      error: { code: 'INTERNAL', message: 'sensitive detail', requestId: 'req-error-3' },
    },
  },
  {
    name: 'status in the JSON body',
    value: {
      error: { code: 'BAD_REQUEST', requestId: 'req-error-4', status: 400 },
    },
  },
  {
    name: 'non-array field details',
    value: {
      error: { code: 'BAD_REQUEST', fields: { bbox: 'invalid' }, requestId: 'req-error-5' },
    },
  },
  {
    name: 'extra envelope property',
    value: {
      error: { code: 'INTERNAL', requestId: 'req-error-6' },
      raw: 'must-not-cross-the-boundary',
    },
  },
  {
    name: 'stack detail',
    value: {
      error: { code: 'INTERNAL', requestId: 'req-error-7', stack: 'secret stack' },
    },
  },
  {
    name: 'secret detail',
    value: {
      error: { code: 'INTERNAL', requestId: 'req-error-8', secret: 'provider-key' },
    },
  },
  {
    name: 'mixed error and success envelope',
    value: {
      data: null,
      error: { code: 'INTERNAL', requestId: 'req-error-9' },
    },
  },
] as const;
