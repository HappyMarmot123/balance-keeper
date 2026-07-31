import type { CctvBounds } from '../../../entities/cctv/contract';
import { isSafeCctvMediaPath } from '../../../entities/cctv/contract';
import { fetchItsCctvStillMetadata, ItsCctvProviderError } from './cctvList';
import { selectItsCctvMetadataById } from './cctvMetadata';

export const ITS_CCTV_STILL_IMAGE_MAX_BYTES = 512 * 1_024;
export const ITS_CCTV_STILL_IMAGE_MAX_DIMENSION = 4_096;

export type FetchItsCctvStillMetadataByIdOptions = Readonly<{
  bounds: CctvBounds;
  cameraId: string;
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}>;

export type ItsCctvStillMetadata = Readonly<{
  cameraId: string;
  url: string;
}>;

export type FetchItsCctvStillImageOptions = Readonly<{
  fetcher: typeof fetch;
  signal: AbortSignal;
  url: string;
}>;

export type ItsCctvStillImage = Readonly<{
  bytes: Uint8Array;
  height: number;
  width: number;
}>;

export async function fetchItsCctvStillMetadataById(
  options: FetchItsCctvStillMetadataByIdOptions,
): Promise<ItsCctvStillMetadata> {
  const metadata = await fetchItsCctvStillMetadata(options);
  return selectItsCctvMetadataById(metadata, options.cameraId);
}

const parseStillImageUrl = (value: string): string => {
  if (!isSafeCctvMediaPath(value, 'still-image')) {
    throw new ItsCctvProviderError('ITS CCTV still image URL path is invalid');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ItsCctvProviderError('ITS CCTV still image URL is invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'cctvsec.ktict.co.kr' ||
    url.port !== '8091' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname === '/'
  ) {
    throw new ItsCctvProviderError('ITS CCTV still image URL is outside the approved boundary');
  }
  return url.href;
};

const readJpegDimensions = (bytes: Uint8Array): Readonly<{ height: number; width: number }> => {
  if (
    bytes.byteLength < 8 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    throw new ItsCctvProviderError('ITS CCTV still image JPEG signature is invalid');
  }

  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let dimensions: Readonly<{ height: number; width: number }> | undefined;
  let offset = 2;
  while (offset < bytes.byteLength - 2) {
    if (bytes[offset] !== 0xff) {
      throw new ItsCctvProviderError('ITS CCTV still image JPEG structure is invalid');
    }

    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || marker === 0xd9) {
      throw new ItsCctvProviderError('ITS CCTV still image JPEG marker is invalid');
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 1 >= bytes.byteLength - 2) {
      throw new ItsCctvProviderError('ITS CCTV still image JPEG segment is invalid');
    }
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.byteLength - 2) {
      throw new ItsCctvProviderError('ITS CCTV still image JPEG segment is invalid');
    }

    if (startOfFrameMarkers.has(marker)) {
      const componentCount = bytes[offset + 7];
      if (
        dimensions !== undefined ||
        componentCount === undefined ||
        componentCount < 1 ||
        componentCount > 4 ||
        segmentLength !== 8 + 3 * componentCount
      ) {
        throw new ItsCctvProviderError('ITS CCTV still image JPEG dimensions are invalid');
      }
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      if (
        height === 0 ||
        width === 0 ||
        height > ITS_CCTV_STILL_IMAGE_MAX_DIMENSION ||
        width > ITS_CCTV_STILL_IMAGE_MAX_DIMENSION
      ) {
        throw new ItsCctvProviderError('ITS CCTV still image JPEG dimensions are invalid');
      }
      dimensions = { height, width };
    }

    if (marker === 0xda) {
      const scanComponentCount = bytes[offset + 2];
      if (
        dimensions === undefined ||
        scanComponentCount === undefined ||
        scanComponentCount < 1 ||
        scanComponentCount > 4 ||
        segmentLength !== 6 + 2 * scanComponentCount ||
        segmentEnd >= bytes.byteLength - 2
      ) {
        throw new ItsCctvProviderError('ITS CCTV still image JPEG scan is invalid');
      }
      return dimensions;
    }

    offset = segmentEnd;
  }

  throw new ItsCctvProviderError('ITS CCTV still image JPEG scan is missing');
};

const cancelResponseBody = async (response: Response, reason?: unknown): Promise<void> => {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Best effort only: the original boundary failure remains authoritative.
  }
};

const readBoundedBody = async (
  response: Response,
  signal: AbortSignal,
  declaredLength: number | null,
): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new ItsCctvProviderError('ITS CCTV still image body is missing');
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  const cancelOnAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', cancelOnAbort, { once: true });

  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      }
      if (next.done) {
        break;
      }
      received += next.value.byteLength;
      if (received > ITS_CCTV_STILL_IMAGE_MAX_BYTES) {
        await reader.cancel();
        throw new ItsCctvProviderError('ITS CCTV still image size exceeds the allowed limit');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    if (error instanceof ItsCctvProviderError) {
      throw error;
    }
    throw new ItsCctvProviderError('ITS CCTV still image body could not be read');
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }

  if (received === 0) {
    throw new ItsCctvProviderError('ITS CCTV still image body is empty');
  }
  if (declaredLength !== null && received !== declaredLength) {
    throw new ItsCctvProviderError('ITS CCTV still image size is inconsistent');
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export async function fetchItsCctvStillImage(options: FetchItsCctvStillImageOptions): Promise<ItsCctvStillImage> {
  const url = parseStillImageUrl(options.url);
  if (options.signal.aborted) {
    throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }

  let response: Response;
  try {
    response = await options.fetcher(url, {
      credentials: 'omit',
      headers: { Accept: 'image/jpeg' },
      method: 'GET',
      redirect: 'error',
      signal: options.signal,
    });
  } catch {
    if (options.signal.aborted) {
      throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    throw new ItsCctvProviderError('ITS CCTV still image request failed');
  }

  if (options.signal.aborted) {
    await cancelResponseBody(response, options.signal.reason);
    throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }
  if (response.status !== 200 || response.redirected || response.url !== url) {
    await cancelResponseBody(response);
    throw new ItsCctvProviderError('ITS CCTV still image response boundary is invalid');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'image/jpeg') {
    await cancelResponseBody(response);
    throw new ItsCctvProviderError('ITS CCTV still image content type is invalid');
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^[1-9]\d*$/u.test(declaredLength) || Number(declaredLength) > ITS_CCTV_STILL_IMAGE_MAX_BYTES)
  ) {
    await cancelResponseBody(response);
    throw new ItsCctvProviderError('ITS CCTV still image declared size is invalid');
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response, options.signal, declaredLength === null ? null : Number(declaredLength));
  } catch (error) {
    if (options.signal.aborted) {
      throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    if (error instanceof ItsCctvProviderError) {
      throw error;
    }
    throw new ItsCctvProviderError('ITS CCTV still image body could not be read');
  }
  const dimensions = readJpegDimensions(bytes);
  return Object.freeze({
    bytes,
    ...dimensions,
  });
}
