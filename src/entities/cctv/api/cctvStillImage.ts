import { AppError, errorEnvelopeSchema, statusForApiErrorCode } from '../../../shared/contracts';
import { type CctvBounds, type CctvCameraId, canonicalizeCctvBounds, cctvCameraIdSchema } from '../model/cctv';

export const CCTV_STILL_IMAGE_MAX_BYTES = 512 * 1_024;

export type CctvStillImageReference = Readonly<{
  bounds: CctvBounds;
  cameraId: CctvCameraId;
}>;

export type CctvStillImageFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FetchCctvStillImageOptions = Readonly<{
  fetcher?: CctvStillImageFetcher;
  signal?: AbortSignal;
}>;

const formatCoordinate = (value: number): string => String(Number(value.toFixed(4)));

export function createCctvStillImagePath(reference: CctvStillImageReference): `/api/cctv/image?${string}` {
  const cameraId = cctvCameraIdSchema.parse(reference.cameraId);
  const bounds = canonicalizeCctvBounds(reference.bounds);
  const bbox = [bounds.minimumLongitude, bounds.minimumLatitude, bounds.maximumLongitude, bounds.maximumLatitude]
    .map(formatCoordinate)
    .join(',');
  return `/api/cctv/image?cameraId=${encodeURIComponent(cameraId)}&bbox=${bbox}`;
}

const cancelResponseBody = async (response: Response, reason?: unknown): Promise<void> => {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Best effort only: preserve the validation or cancellation result.
  }
};

const readBoundedBody = async (
  response: Response,
  signal: AbortSignal | undefined,
  declaredLength: number | null,
): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new AppError('INVALID_RESPONSE', { status: response.status });
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  const cancelOnAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', cancelOnAbort, { once: true });

  try {
    while (true) {
      const next = await reader.read();
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      }
      if (next.done) {
        break;
      }
      received += next.value.byteLength;
      if (received > CCTV_STILL_IMAGE_MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The byte-cap violation remains authoritative.
        }
        throw new AppError('INVALID_RESPONSE', { status: response.status });
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('NETWORK_ERROR', { cause: error });
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }

  if (received === 0 || (declaredLength !== null && received !== declaredLength)) {
    throw new AppError('INVALID_RESPONSE', { status: response.status });
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export async function fetchCctvStillImage(
  reference: CctvStillImageReference,
  options: FetchCctvStillImageOptions = {},
): Promise<Blob> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }
  let response: Response;

  try {
    response = await fetcher(createCctvStillImagePath(reference), {
      credentials: 'omit',
      headers: { Accept: 'image/jpeg' },
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
      throw error;
    }
    throw new AppError('NETWORK_ERROR', { cause: error });
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!response.ok) {
    if (contentType !== 'application/json') {
      await cancelResponseBody(response);
      throw new AppError('INVALID_RESPONSE', { status: response.status });
    }
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^[1-9]\d*$/u.test(declaredLength) || Number(declaredLength) > CCTV_STILL_IMAGE_MAX_BYTES)
    ) {
      await cancelResponseBody(response);
      throw new AppError('INVALID_RESPONSE', { status: response.status });
    }
    let payload: unknown;
    try {
      const bytes = await readBoundedBody(
        response,
        options.signal,
        declaredLength === null ? null : Number(declaredLength),
      );
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INVALID_RESPONSE', { cause: error, status: response.status });
    }
    const parsed = errorEnvelopeSchema.safeParse(payload);
    if (!parsed.success || statusForApiErrorCode(parsed.data.error.code) !== response.status) {
      throw new AppError('INVALID_RESPONSE', {
        cause: parsed.success ? undefined : parsed.error,
        status: response.status,
      });
    }
    throw new AppError(parsed.data.error.code, {
      fields: parsed.data.error.fields,
      requestId: parsed.data.error.requestId,
      status: response.status,
    });
  }

  if (response.status !== 200 || response.redirected || contentType !== 'image/jpeg') {
    await cancelResponseBody(response);
    throw new AppError('INVALID_RESPONSE', { status: response.status });
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^[1-9]\d*$/u.test(declaredLength) || Number(declaredLength) > CCTV_STILL_IMAGE_MAX_BYTES)
  ) {
    await cancelResponseBody(response);
    throw new AppError('INVALID_RESPONSE', { status: response.status });
  }

  const bytes = await readBoundedBody(
    response,
    options.signal,
    declaredLength === null ? null : Number(declaredLength),
  );
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    throw new AppError('INVALID_RESPONSE', { status: response.status });
  }

  return new Blob([bytes.slice().buffer], { type: 'image/jpeg' });
}
