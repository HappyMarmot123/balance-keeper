import type { ApiErrorCode, ApiErrorStatus, ErrorFields } from './transport';

const statusByApiErrorCode = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_CONTENT: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 502,
  MISSING_CREDENTIALS: 503,
  SERVICE_UNAVAILABLE: 503,
  NETWORK_ERROR: 0,
  INVALID_RESPONSE: 0,
} as const satisfies Record<ApiErrorCode, ApiErrorStatus>;

export type AppErrorOptions = {
  cause?: unknown;
  fields?: ErrorFields;
  requestId?: string;
  status?: ApiErrorStatus;
};

export const statusForApiErrorCode = (code: ApiErrorCode): ApiErrorStatus => statusByApiErrorCode[code];

const isAllowedStatus = (code: ApiErrorCode, status: number): status is ApiErrorStatus => {
  if (!Number.isInteger(status)) {
    return false;
  }

  if (code === 'INVALID_RESPONSE') {
    return status === 0 || (status >= 100 && status <= 599);
  }

  return status === statusForApiErrorCode(code);
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly fields: ErrorFields | undefined;
  readonly requestId: string | undefined;
  readonly status: ApiErrorStatus;

  constructor(code: ApiErrorCode, options: AppErrorOptions = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    const status = options.status ?? statusForApiErrorCode(code);

    if (!isAllowedStatus(code, status)) {
      throw new TypeError('Invalid API error status');
    }

    this.name = 'AppError';
    this.code = code;
    this.fields = options.fields;
    this.requestId = options.requestId;
    this.status = status;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
