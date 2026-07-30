import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  type CctvBounds,
  type CctvCamera,
  type CctvRoadType,
  type CctvSnapshot,
  cctvBoundsSchema,
  cctvDataSchema,
  compareCctvCameras,
  isSafeCctvMediaPath,
} from '../../../entities/cctv/contract';

const ITS_CCTV_ENDPOINT = 'https://openapi.its.go.kr:9443/cctvInfo';
const KST_OFFSET_MS = 9 * 60 * 60_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

const rawTextSchema = (maximum: number) => z.string().max(maximum);
const rawCoordinateSchema = z.number().finite();

const rawBaseRowSchema = z.object({
  cctvname: z.string().trim().min(1).max(160),
  cctvresolution: rawTextSchema(100),
  coordx: rawCoordinateSchema,
  coordy: rawCoordinateSchema,
  filecreatetime: z.union([z.literal(''), z.string().regex(/^\d{14}$/u)]),
  roadsectionid: rawTextSchema(200),
});

const rawStillRowSchema = rawBaseRowSchema
  .extend({
    cctvformat: z.literal('JPEG'),
    cctvtype: z.literal(3),
    cctvurl: z.string().min(1).max(2_048),
    cctvurl2: z.string().min(1).max(2_048),
  })
  .strict();

const rawLiveRowSchema = rawBaseRowSchema
  .extend({
    cctvformat: z.literal('HLS'),
    cctvtype: z.literal(4),
    cctvurl: z.string().min(1).max(2_048),
  })
  .strict();

const createRawResponseSchema = <RowSchema extends z.ZodType>(rowSchema: RowSchema) =>
  z.union([
    z
      .object({
        response: z
          .object({
            coordtype: z.literal(1),
            data: z.array(rowSchema).min(1).max(2_000),
            datacount: z.number().int().positive().max(2_000),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        response: z
          .object({
            coordtype: z.null(),
            datacount: z.literal(0),
          })
          .strict(),
      })
      .strict(),
  ]);

const rawStillResponseSchema = createRawResponseSchema(rawStillRowSchema);
const rawLiveResponseSchema = createRawResponseSchema(rawLiveRowSchema);

type RawStillRow = z.infer<typeof rawStillRowSchema>;
type RawLiveRow = z.infer<typeof rawLiveRowSchema>;
type ProviderRoadType = 'ex' | 'its';
type ProviderMediaType = '3' | '4';

type NormalizedProviderRow = Readonly<{
  createdAt: number | null;
  identity: string;
  latitude: number;
  longitude: number;
  name: string;
  resolution: string | null;
  roadSectionId: string | null;
  url: string;
}>;

export type FetchItsCctvListOptions = Readonly<{
  bounds: CctvBounds;
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class ItsCctvProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItsCctvProviderError';
  }
}

const toDomainRoadType = (roadType: ProviderRoadType): CctvRoadType =>
  roadType === 'ex' ? 'expressway' : 'national-road';

const createRequestUrl = (
  bounds: CctvBounds,
  serviceKey: string,
  roadType: ProviderRoadType,
  mediaType: ProviderMediaType,
): URL => {
  const url = new URL(ITS_CCTV_ENDPOINT);
  url.searchParams.set('apiKey', serviceKey);
  url.searchParams.set('type', roadType);
  url.searchParams.set('cctvType', mediaType);
  url.searchParams.set('minX', String(bounds.minimumLongitude));
  url.searchParams.set('maxX', String(bounds.maximumLongitude));
  url.searchParams.set('minY', String(bounds.minimumLatitude));
  url.searchParams.set('maxY', String(bounds.maximumLatitude));
  url.searchParams.set('getType', 'json');
  return url;
};

const parseProviderTimestamp = (value: string): number | null => {
  if (value === '') {
    return null;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const calendar = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    throw new ItsCctvProviderError('ITS CCTV file timestamp is invalid');
  }
  return calendar.getTime() - KST_OFFSET_MS;
};

const assertInsideBounds = (longitude: number, latitude: number, bounds: CctvBounds): void => {
  if (
    longitude < bounds.minimumLongitude ||
    longitude > bounds.maximumLongitude ||
    latitude < bounds.minimumLatitude ||
    latitude > bounds.maximumLatitude
  ) {
    throw new ItsCctvProviderError('ITS CCTV coordinate is outside the requested bounds');
  }
};

const parseMediaUrl = (value: string, kind: 'discarded-http-still' | 'live-hls' | 'still-image'): string => {
  const mediaPathKind = kind === 'live-hls' ? 'live-hls' : 'still-image';
  if (!isSafeCctvMediaPath(value, mediaPathKind)) {
    throw new ItsCctvProviderError('ITS CCTV media URL path is invalid');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ItsCctvProviderError('ITS CCTV media URL is invalid');
  }
  const commonSafe =
    url.hostname === 'cctvsec.ktict.co.kr' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.pathname !== '/';
  const approved =
    kind === 'discarded-http-still'
      ? commonSafe && url.protocol === 'http:' && url.port === '8090'
      : kind === 'still-image'
        ? commonSafe && url.protocol === 'https:' && url.port === '8091'
        : commonSafe && url.protocol === 'https:' && url.port === '';
  if (!approved) {
    throw new ItsCctvProviderError('ITS CCTV media URL is outside the approved boundary');
  }
  return url.href;
};

const createProviderIdentity = (
  roadType: ProviderRoadType,
  row: Pick<RawStillRow | RawLiveRow, 'cctvname' | 'coordx' | 'coordy' | 'roadsectionid'>,
): string => JSON.stringify([roadType, row.roadsectionid.trim(), row.cctvname.trim(), row.coordx, row.coordy]);

const normalizeBaseRow = (
  row: RawStillRow | RawLiveRow,
  bounds: CctvBounds,
  roadType: ProviderRoadType,
  url: string,
): NormalizedProviderRow => {
  assertInsideBounds(row.coordx, row.coordy, bounds);
  const resolution = row.cctvresolution.trim();
  const roadSectionId = row.roadsectionid.trim();
  return {
    createdAt: parseProviderTimestamp(row.filecreatetime),
    identity: createProviderIdentity(roadType, row),
    latitude: row.coordy,
    longitude: row.coordx,
    name: row.cctvname.trim(),
    resolution: resolution === '' ? null : resolution,
    roadSectionId: roadSectionId === '' ? null : roadSectionId,
    url,
  };
};

const parseRows = (
  input: unknown,
  bounds: CctvBounds,
  roadType: ProviderRoadType,
  mediaType: ProviderMediaType,
): readonly NormalizedProviderRow[] => {
  if (mediaType === '3') {
    const parsed = rawStillResponseSchema.safeParse(input);
    if (!parsed.success) {
      throw new ItsCctvProviderError('ITS CCTV still response is invalid');
    }
    if (!('data' in parsed.data.response)) {
      return [];
    }
    if (parsed.data.response.datacount !== parsed.data.response.data.length) {
      throw new ItsCctvProviderError('ITS CCTV still count is inconsistent');
    }
    return parsed.data.response.data.map((row) => {
      parseMediaUrl(row.cctvurl, 'discarded-http-still');
      return normalizeBaseRow(row, bounds, roadType, parseMediaUrl(row.cctvurl2, 'still-image'));
    });
  }

  const parsed = rawLiveResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new ItsCctvProviderError('ITS CCTV live response is invalid');
  }
  if (!('data' in parsed.data.response)) {
    return [];
  }
  if (parsed.data.response.datacount !== parsed.data.response.data.length) {
    throw new ItsCctvProviderError('ITS CCTV live count is inconsistent');
  }
  return parsed.data.response.data.map((row) =>
    normalizeBaseRow(row, bounds, roadType, parseMediaUrl(row.cctvurl, 'live-hls')),
  );
};

const fetchRows = async (
  options: FetchItsCctvListOptions,
  roadType: ProviderRoadType,
  mediaType: ProviderMediaType,
): Promise<readonly NormalizedProviderRow[]> => {
  const url = createRequestUrl(options.bounds, options.serviceKey, roadType, mediaType);
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
      throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    throw new ItsCctvProviderError('ITS CCTV request failed');
  }
  if (!response.ok) {
    throw new ItsCctvProviderError('ITS CCTV request returned a non-success status');
  }
  if (response.redirected || (response.url !== '' && response.url !== url.href)) {
    throw new ItsCctvProviderError('ITS CCTV redirect is not allowed');
  }
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (contentType !== 'application/json') {
    throw new ItsCctvProviderError('ITS CCTV response content type is invalid');
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES) {
      throw new ItsCctvProviderError('ITS CCTV response size exceeds the allowed limit');
    }
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader !== undefined) {
    try {
      while (true) {
        const next = await reader.read();
        if (options.signal.aborted) {
          throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
        }
        if (next.done) {
          break;
        }
        received += next.value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new ItsCctvProviderError('ITS CCTV response size exceeds the allowed limit');
        }
        chunks.push(next.value);
      }
    } catch (error) {
      if (options.signal.aborted) {
        throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      }
      if (error instanceof ItsCctvProviderError) {
        throw error;
      }
      throw new ItsCctvProviderError('ITS CCTV response body could not be read');
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ItsCctvProviderError('ITS CCTV response is not valid UTF-8');
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    throw new ItsCctvProviderError('ITS CCTV response was not valid JSON');
  }
  return parseRows(input, options.bounds, roadType, mediaType);
};

const toStableId = (identity: string): string =>
  `its-cctv:${createHash('sha256').update(identity, 'utf8').digest('base64url').slice(0, 16)}`;

const indexRows = (rows: readonly NormalizedProviderRow[]): ReadonlyMap<string, NormalizedProviderRow> => {
  const indexed = new Map<string, NormalizedProviderRow>();
  for (const row of rows) {
    if (indexed.has(row.identity)) {
      throw new ItsCctvProviderError('ITS CCTV response contains a duplicate camera identity');
    }
    indexed.set(row.identity, row);
  }
  return indexed;
};

export async function fetchItsCctvStillMetadata(
  options: FetchItsCctvListOptions,
): Promise<readonly Readonly<{ cameraId: string; url: string }>[]> {
  const bounds = cctvBoundsSchema.parse(options.bounds);
  if (options.serviceKey.trim().length === 0) {
    throw new ItsCctvProviderError('ITS CCTV credential is missing');
  }
  if (options.signal.aborted) {
    throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }

  const requestController = new AbortController();
  const forwardParentAbort = () => {
    requestController.abort(options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
  };
  options.signal.addEventListener('abort', forwardParentAbort, { once: true });

  let rows: [readonly NormalizedProviderRow[], readonly NormalizedProviderRow[]];
  try {
    rows = await Promise.all([
      fetchRows({ ...options, bounds, signal: requestController.signal }, 'ex', '3'),
      fetchRows({ ...options, bounds, signal: requestController.signal }, 'its', '3'),
    ]);
  } catch (error) {
    requestController.abort(error);
    throw error;
  } finally {
    options.signal.removeEventListener('abort', forwardParentAbort);
  }

  const metadataByCameraId = new Map<string, Readonly<{ cameraId: string; url: string }>>();
  for (const roadRows of rows) {
    for (const row of indexRows(roadRows).values()) {
      const cameraId = toStableId(row.identity);
      if (metadataByCameraId.has(cameraId)) {
        throw new ItsCctvProviderError('ITS CCTV response contains a duplicate stable camera ID');
      }
      metadataByCameraId.set(
        cameraId,
        Object.freeze({
          cameraId,
          url: row.url,
        }),
      );
    }
  }
  return [...metadataByCameraId.values()];
}

const mergeRoadRows = (
  roadType: ProviderRoadType,
  stillRows: readonly NormalizedProviderRow[],
  liveRows: readonly NormalizedProviderRow[],
): CctvCamera[] => {
  const stillByIdentity = indexRows(stillRows);
  const liveByIdentity = indexRows(liveRows);
  if (
    stillByIdentity.size !== liveByIdentity.size ||
    [...stillByIdentity.keys()].some((identity) => !liveByIdentity.has(identity))
  ) {
    throw new ItsCctvProviderError('ITS CCTV still and live inventories are inconsistent');
  }

  return [...stillByIdentity.entries()].map(([identity, still]) => {
    const live = liveByIdentity.get(identity);
    if (live === undefined) {
      throw new ItsCctvProviderError('ITS CCTV live metadata is missing');
    }
    return {
      id: toStableId(identity),
      latitude: still.latitude,
      longitude: still.longitude,
      media: {
        liveHls: {
          createdAt: live.createdAt,
          resolution: live.resolution,
          url: live.url,
        },
        stillImage: {
          createdAt: still.createdAt,
          resolution: still.resolution,
          url: still.url,
        },
      },
      name: still.name,
      roadSectionId: still.roadSectionId,
      roadType: toDomainRoadType(roadType),
    };
  });
};

export async function fetchItsCctvList(options: FetchItsCctvListOptions): Promise<CctvSnapshot> {
  const bounds = cctvBoundsSchema.parse(options.bounds);
  if (options.serviceKey.trim().length === 0) {
    throw new ItsCctvProviderError('ITS CCTV credential is missing');
  }
  if (options.signal.aborted) {
    throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }

  const requestController = new AbortController();
  const forwardParentAbort = () => {
    requestController.abort(options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
  };
  options.signal.addEventListener('abort', forwardParentAbort, { once: true });

  let rows: [
    readonly NormalizedProviderRow[],
    readonly NormalizedProviderRow[],
    readonly NormalizedProviderRow[],
    readonly NormalizedProviderRow[],
  ];
  try {
    rows = await Promise.all([
      fetchRows({ ...options, bounds, signal: requestController.signal }, 'ex', '3'),
      fetchRows({ ...options, bounds, signal: requestController.signal }, 'its', '3'),
      fetchRows({ ...options, bounds, signal: requestController.signal }, 'ex', '4'),
      fetchRows({ ...options, bounds, signal: requestController.signal }, 'its', '4'),
    ]);
  } catch (error) {
    requestController.abort(error);
    throw error;
  } finally {
    options.signal.removeEventListener('abort', forwardParentAbort);
  }

  const [expresswayStill, nationalRoadStill, expresswayLive, nationalRoadLive] = rows;
  return cctvDataSchema.parse({
    bounds,
    cameras: [
      ...mergeRoadRows('ex', expresswayStill, expresswayLive),
      ...mergeRoadRows('its', nationalRoadStill, nationalRoadLive),
    ].sort(compareCctvCameras),
  });
}

export function readItsCredential(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const credential = environment.ITS_API_KEY?.trim() ?? '';
  return credential.length === 0 ? undefined : credential;
}
