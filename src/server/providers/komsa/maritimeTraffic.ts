import { z } from 'zod';

import {
  MARITIME_TRAFFIC_MAX_CELLS,
  type MaritimeTrafficSnapshot,
  maritimeTrafficSnapshotSchema,
} from '../../../entities/maritime-traffic/contract';

const KOMSA_MARITIME_TRAFFIC_ENDPOINT = 'https://apis.data.go.kr/B554035/realtime/get_realtime';
const KOMSA_PAGE_SIZE = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const KOREA_STANDARD_TIME_OFFSET_MS = 9 * 60 * 60 * 1_000;
const PROVIDER_TIMESTAMP_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})$/u;

const providerCellSchema = z
  .object({
    dnsty: z.number().finite().min(0).max(100),
    grid_id: z
      .string()
      .min(1)
      .max(128)
      .refine((gridId) => gridId === gridId.trim()),
    vmtc: z.number().finite().int().nonnegative().safe(),
  })
  .strict();

const providerHeaderSchema = z
  .object({
    resultCode: z.string().min(1).max(32),
    resultMsg: z.string().max(1_024),
  })
  .strict();

const providerHeaderEnvelopeSchema = z
  .object({
    response: z
      .object({
        header: providerHeaderSchema,
      })
      .passthrough(),
  })
  .passthrough();

const providerResponseSchema = z
  .object({
    response: z
      .object({
        body: z
          .object({
            dataType: z.literal('JSON'),
            items: z
              .object({
                item: z.union([providerCellSchema, z.array(providerCellSchema).max(MARITIME_TRAFFIC_MAX_CELLS)]),
              })
              .strict(),
            numOfRows: z.number().int().positive().safe(),
            pageNo: z.number().int().positive().safe(),
            regDt: z.string().min(1).max(64),
            totalCount: z.number().int().nonnegative().safe(),
          })
          .strict(),
        header: providerHeaderSchema,
      })
      .strict(),
  })
  .strict();

export type FetchMaritimeTrafficSnapshotOptions = Readonly<{
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class KomsaMaritimeTrafficProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KomsaMaritimeTrafficProviderError';
  }
}

const normalizeServiceKey = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic credential is missing');
  }
  if (!/%[0-9a-f]{2}/iu.test(trimmed)) {
    return trimmed;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic credential encoding is invalid');
  }
};

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const parseKoreaStandardTime = (input: string): number => {
  const match = PROVIDER_TIMESTAMP_PATTERN.exec(input);
  if (match?.groups === undefined) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic generation timestamp is invalid');
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second);
  const localWallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const calendar = new Date(localWallClockAsUtc);

  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic generation timestamp is invalid');
  }

  const generatedAt = localWallClockAsUtc - KOREA_STANDARD_TIME_OFFSET_MS;
  if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic generation timestamp is invalid');
  }
  return generatedAt;
};

const parseProviderResponse = (input: unknown) => {
  const headerResult = providerHeaderEnvelopeSchema.safeParse(input);
  if (!headerResult.success) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response is invalid');
  }
  if (headerResult.data.response.header.resultCode !== '00') {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic provider returned a non-success result');
  }

  const responseResult = providerResponseSchema.safeParse(input);
  if (!responseResult.success) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response is invalid');
  }
  return responseResult.data.response.body;
};

const assertResponseMetadata = (response: Response): void => {
  if (response.url.length > 0) {
    let finalUrl: URL;
    try {
      finalUrl = new URL(response.url);
    } catch {
      throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic redirect is not allowed');
    }
    const expectedUrl = new URL(KOMSA_MARITIME_TRAFFIC_ENDPOINT);
    if (finalUrl.origin !== expectedUrl.origin || finalUrl.pathname !== expectedUrl.pathname) {
      throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic redirect is not allowed');
    }
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response content type is invalid');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response size is invalid');
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_RESPONSE_BYTES) {
      throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response size exceeds the allowed limit');
    }
  }
};

const readBoundedUtf8 = async (response: Response, signal: AbortSignal): Promise<string> => {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted) {
        throwAbortReason(signal);
      }
      if (next.done) {
        break;
      }
      receivedBytes += next.value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response size exceeds the allowed limit');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof KomsaMaritimeTrafficProviderError) {
      throw error;
    }
    if (signal.aborted) {
      throwAbortReason(signal);
    }
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response read failed');
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response was not valid UTF-8');
  }
};

export async function fetchMaritimeTrafficSnapshot(
  options: FetchMaritimeTrafficSnapshotOptions,
): Promise<MaritimeTrafficSnapshot> {
  const serviceKey = normalizeServiceKey(options.serviceKey);

  const url = new URL(KOMSA_MARITIME_TRAFFIC_ENDPOINT);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', String(KOMSA_PAGE_SIZE));
  url.searchParams.set('dataType', 'JSON');

  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }

  let response: Response;
  try {
    response = await options.fetcher(url, {
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      signal: options.signal,
    });
  } catch {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic request failed');
  }
  if (!response.ok) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic request returned a non-success status');
  }
  assertResponseMetadata(response);
  let input: unknown;
  try {
    input = JSON.parse(await readBoundedUtf8(response, options.signal));
  } catch (error) {
    if (error instanceof KomsaMaritimeTrafficProviderError) {
      throw error;
    }
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response was not valid JSON');
  }
  const providerBody = parseProviderResponse(input);
  const providerItems = providerBody.items.item;
  const items = Array.isArray(providerItems) ? providerItems : [providerItems];

  if (
    providerBody.pageNo !== 1 ||
    providerBody.numOfRows !== KOMSA_PAGE_SIZE ||
    providerBody.totalCount > MARITIME_TRAFFIC_MAX_CELLS ||
    providerBody.totalCount !== items.length
  ) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic pagination is invalid');
  }

  const seenGridIds = new Set<string>();
  const cells = items.map((item) => {
    if (seenGridIds.has(item.grid_id)) {
      throw new KomsaMaritimeTrafficProviderError(
        'KOMSA maritime traffic response contains a duplicate grid identifier',
      );
    }
    seenGridIds.add(item.grid_id);
    return {
      densityPercent: item.dnsty,
      gridId: item.grid_id,
      vesselCount: item.vmtc,
    };
  });
  cells.sort((left, right) => {
    if (left.gridId < right.gridId) {
      return -1;
    }
    return left.gridId > right.gridId ? 1 : 0;
  });

  const generatedAt = parseKoreaStandardTime(providerBody.regDt);
  const snapshotResult = maritimeTrafficSnapshotSchema.safeParse({
    cells,
    generatedAt,
  });
  if (!snapshotResult.success) {
    throw new KomsaMaritimeTrafficProviderError('KOMSA maritime traffic response is invalid');
  }
  return snapshotResult.data;
}
