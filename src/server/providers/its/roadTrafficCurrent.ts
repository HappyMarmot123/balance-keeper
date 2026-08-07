import { z } from 'zod';

import {
  canonicalizeRoadTrafficCurrentBounds,
  compareRoadTrafficCurrentSegments,
  ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH,
  ROAD_TRAFFIC_CURRENT_MAX_SEGMENTS,
  ROAD_TRAFFIC_CURRENT_SPEED_UNIT,
  type RoadTrafficCurrentBounds,
  type RoadTrafficCurrentSegment,
  type RoadTrafficCurrentSnapshot,
  roadTrafficCurrentDataSchema,
} from '../../../entities/road-traffic/contract';

const ITS_ROAD_TRAFFIC_CURRENT_ENDPOINT = 'https://openapi.its.go.kr:9443/trafficInfo';
export const ITS_ROAD_TRAFFIC_CURRENT_MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;

const boundedTextSchema = (maximum: number) => z.string().max(maximum);
const canonicalIdSchema = boundedTextSchema(ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH)
  .min(1)
  .refine((value) => value.trim().length > 0 && value === value.trim());
const numericScalarSchema = z.union([z.number().finite(), z.string().regex(/^\d+(?:\.\d+)?$/u)]);
const countScalarSchema = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/u)]);
const resultCodeSchema = z.union([z.number().int().safe(), z.string().min(1).max(32)]);

const providerRowSchema = z
  .object({
    createdDate: z.string().max(32),
    endNodeId: boundedTextSchema(ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH),
    linkId: canonicalIdSchema,
    linkNo: boundedTextSchema(ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH),
    roadDrcType: boundedTextSchema(64),
    roadName: boundedTextSchema(200),
    speed: numericScalarSchema,
    startNodeId: boundedTextSchema(ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH),
    travelTime: numericScalarSchema,
  })
  .strict();
const providerRowsSchema = z.union([
  providerRowSchema,
  z.array(providerRowSchema).max(ROAD_TRAFFIC_CURRENT_MAX_SEGMENTS),
]);
const providerEnvelopeSchema = z
  .object({
    body: z
      .object({
        items: providerRowsSchema,
        totalCount: countScalarSchema,
      })
      .strict(),
    header: z
      .object({
        resultCode: resultCodeSchema,
        resultMsg: boundedTextSchema(1_024),
      })
      .strict(),
  })
  .strict();

type ProviderRow = z.infer<typeof providerRowSchema>;

export type FetchItsRoadTrafficCurrentOptions = Readonly<{
  bounds: RoadTrafficCurrentBounds;
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class ItsRoadTrafficCurrentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItsRoadTrafficCurrentProviderError';
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const createRequestUrl = (bounds: RoadTrafficCurrentBounds, serviceKey: string): URL => {
  const url = new URL(ITS_ROAD_TRAFFIC_CURRENT_ENDPOINT);
  url.searchParams.set('apiKey', serviceKey);
  url.searchParams.set('type', 'all');
  url.searchParams.set('minX', String(bounds.minimumLongitude));
  url.searchParams.set('maxX', String(bounds.maximumLongitude));
  url.searchParams.set('minY', String(bounds.minimumLatitude));
  url.searchParams.set('maxY', String(bounds.maximumLatitude));
  url.searchParams.set('getType', 'json');
  return url;
};

const assertResponseMetadata = (response: Response, requestUrl: URL): void => {
  if (response.redirected) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current redirect is not allowed');
  }
  if (response.url.length > 0 && response.url !== requestUrl.href) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current redirect is not allowed');
  }
  if (response.status !== 200) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current request returned a non-success status');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response content type is invalid');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response size is invalid');
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > ITS_ROAD_TRAFFIC_CURRENT_MAX_RESPONSE_BYTES) {
      throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response size exceeds the allowed limit');
    }
  }
};

const readBoundedBody = async (response: Response, signal: AbortSignal): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted) throwAbortReason(signal);
      if (next.done) break;
      received += next.value.byteLength;
      if (received > ITS_ROAD_TRAFFIC_CURRENT_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ItsRoadTrafficCurrentProviderError(
          'ITS road traffic current response size exceeds the allowed limit',
        );
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (signal.aborted) throwAbortReason(signal);
    if (error instanceof ItsRoadTrafficCurrentProviderError) throw error;
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response read failed');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const containsCredential = (input: unknown, serviceKey: string): boolean => {
  if (typeof input === 'string') return input.includes(serviceKey);
  if (Array.isArray(input)) return input.some((value) => containsCredential(value, serviceKey));
  if (input !== null && typeof input === 'object') {
    return Object.entries(input).some(
      ([key, value]) => key.includes(serviceKey) || containsCredential(value, serviceKey),
    );
  }
  return false;
};

const parseJson = (bytes: Uint8Array, serviceKey: string): unknown => {
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response was not valid UTF-8');
  }
  if (body.includes(serviceKey)) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response is invalid');
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response was not valid JSON');
  }
  if (containsCredential(input, serviceKey)) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response is invalid');
  }
  return input;
};

const toCount = (value: number | string): number => {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response count is invalid');
  }
  return count;
};

const toNumber = (value: number | string): number => (typeof value === 'number' ? value : Number(value));
const toNullable = (value: string): string | null => value.trim() || null;

const normalizeRow = (row: ProviderRow): RoadTrafficCurrentSegment => ({
  directionCode: toNullable(row.roadDrcType),
  endNodeId: toNullable(row.endNodeId),
  linkId: row.linkId,
  observedAtSource: row.createdDate,
  roadName: toNullable(row.roadName),
  speed: toNumber(row.speed),
  speedUnit: ROAD_TRAFFIC_CURRENT_SPEED_UNIT,
  startNodeId: toNullable(row.startNodeId),
  travelTimeSeconds: toNumber(row.travelTime),
});

const normalizeRows = (rows: readonly ProviderRow[]): readonly RoadTrafficCurrentSegment[] => {
  const byLinkId = new Map<string, RoadTrafficCurrentSegment>();
  for (const row of rows) {
    const segment = normalizeRow(row);
    const existing = byLinkId.get(segment.linkId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(segment)) {
      throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current link revisions conflict');
    }
    byLinkId.set(segment.linkId, segment);
  }
  return [...byLinkId.values()].sort(compareRoadTrafficCurrentSegments);
};

const parseProviderBody = (input: unknown): readonly ProviderRow[] => {
  const result = providerEnvelopeSchema.safeParse(input);
  if (!result.success) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response is invalid');
  }
  if (result.data.header.resultCode !== 0 && result.data.header.resultCode !== '0') {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current provider returned a non-success result');
  }
  const rows = Array.isArray(result.data.body.items) ? result.data.body.items : [result.data.body.items];
  if (rows.length !== toCount(result.data.body.totalCount)) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response count is inconsistent');
  }
  return rows;
};

export async function fetchItsRoadTrafficCurrent(
  options: FetchItsRoadTrafficCurrentOptions,
): Promise<RoadTrafficCurrentSnapshot> {
  const bounds = canonicalizeRoadTrafficCurrentBounds(options.bounds);
  const serviceKey = options.serviceKey.trim();
  if (serviceKey.length === 0) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current credential is missing');
  }
  if (options.signal.aborted) throwAbortReason(options.signal);
  const requestUrl = createRequestUrl(bounds, serviceKey);

  let response: Response;
  try {
    response = await options.fetcher(requestUrl, {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
    });
  } catch {
    if (options.signal.aborted) throwAbortReason(options.signal);
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current request failed');
  }

  assertResponseMetadata(response, requestUrl);
  const input = parseJson(await readBoundedBody(response, options.signal), serviceKey);
  const rows = parseProviderBody(input);
  const result = roadTrafficCurrentDataSchema.safeParse({
    bounds,
    segments: normalizeRows(rows),
  });
  if (!result.success) {
    throw new ItsRoadTrafficCurrentProviderError('ITS road traffic current response is invalid');
  }
  return result.data;
}
