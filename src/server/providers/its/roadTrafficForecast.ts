import { z } from 'zod';

import {
  compareRoadTrafficForecastSegments,
  ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH,
  ROAD_TRAFFIC_FORECAST_MAX_SEGMENTS,
  ROAD_TRAFFIC_FORECAST_SPEED_UNIT,
  type RoadTrafficForecastSnapshot,
  roadTrafficForecastSnapshotSchema,
} from '../../../entities/road-traffic/contract';

const ITS_ROAD_TRAFFIC_FORECAST_ENDPOINT = 'https://openapi.its.go.kr:9443/bypassFCastInfo';
const KOREA_STANDARD_TIME_OFFSET_MS = 9 * 60 * 60_000;

export const ITS_ROAD_TRAFFIC_FORECAST_SECTION_ID = '1';
export const ITS_ROAD_TRAFFIC_FORECAST_MAX_RESPONSE_BYTES = 256 * 1024;

const canonicalIdSchema = z
  .string()
  .min(1)
  .max(ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH)
  .refine((value) => value === value.trim());
const boundedTextSchema = (maximum: number) => z.string().max(maximum);
const numericScalarSchema = z.union([z.number().finite(), z.string().regex(/^(?:\d+(?:\.\d+)?|\.\d+)$/u)]);
const countScalarSchema = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/u)]);
const resultCodeSchema = z.union([z.number().int().safe(), z.string().min(1).max(32)]);

const providerRowSchema = z
  .object({
    detourId: boundedTextSchema(ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH).refine((value) => value === value.trim()),
    fcastDate: z.string().regex(/^\d{8}$/u),
    fcastHour: z.string().regex(/^(?:[01]\d|2[0-3])$/u),
    length: numericScalarSchema,
    linkId: canonicalIdSchema,
    sectionId: canonicalIdSchema,
    sectionType: z.enum(['D', 'M']),
    speed: numericScalarSchema,
  })
  .strict();

const providerRowsSchema = z.union([
  providerRowSchema,
  z.array(providerRowSchema).max(ROAD_TRAFFIC_FORECAST_MAX_SEGMENTS),
]);
const providerItemsSchema = z.union([
  providerRowsSchema,
  z.object({ item: providerRowsSchema.nullable() }).strict(),
  z.object({}).strict(),
]);
const providerHeaderSchema = z
  .object({
    resultCode: resultCodeSchema,
    resultMsg: boundedTextSchema(1_024),
  })
  .strict();
const providerBodySchema = z
  .object({
    data: providerItemsSchema.nullable().optional(),
    items: providerItemsSchema.nullable().optional(),
    totalCount: countScalarSchema,
  })
  .strict()
  .superRefine((body, context) => {
    if (Object.hasOwn(body, 'data') && Object.hasOwn(body, 'items')) {
      context.addIssue({ code: 'custom', message: 'ITS forecast body must use one item container', path: [] });
    }
  });
const providerCountBodySchema = z.object({ totalCount: countScalarSchema }).strict();

const providerHeaderEnvelopeSchema = z.union([
  z.object({ response: z.object({ header: providerHeaderSchema }).passthrough() }).passthrough(),
  z.object({ header: providerHeaderSchema }).passthrough(),
  z.object({ resultCode: resultCodeSchema, resultMsg: boundedTextSchema(1_024) }).passthrough(),
]);

const providerSuccessEnvelopeSchema = z.union([
  z
    .object({
      body: providerBodySchema,
      header: providerHeaderSchema,
    })
    .strict(),
  z
    .object({
      response: z
        .object({
          body: providerBodySchema,
          header: providerHeaderSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      response: z
        .object({
          body: providerCountBodySchema,
          data: providerItemsSchema.nullable().optional(),
          header: providerHeaderSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      data: providerItemsSchema.nullable().optional(),
      resultCode: resultCodeSchema,
      resultMsg: boundedTextSchema(1_024),
      totalCount: countScalarSchema,
    })
    .strict(),
]);

type ProviderRow = z.infer<typeof providerRowSchema>;
type ProviderItems = z.infer<typeof providerItemsSchema> | null | undefined;
type ProviderBody = z.infer<typeof providerBodySchema>;

export type FetchItsRoadTrafficForecastOptions = Readonly<{
  fetcher: typeof fetch;
  now: number;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class ItsRoadTrafficForecastProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItsRoadTrafficForecastProviderError';
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const toNumber = (value: number | string): number => (typeof value === 'number' ? value : Number(value));

const toCount = (value: number | string): number => {
  const count = toNumber(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response count is invalid');
  }
  return count;
};

const toRows = (items: ProviderItems): readonly ProviderRow[] => {
  if (items === undefined || items === null || (!Array.isArray(items) && Object.keys(items).length === 0)) {
    return [];
  }
  const rows = typeof items === 'object' && !Array.isArray(items) && 'item' in items ? items.item : items;
  if (rows === null) {
    return [];
  }
  return Array.isArray(rows) ? rows : [rows as ProviderRow];
};

const readHeaderCode = (input: z.infer<typeof providerHeaderEnvelopeSchema>): number | string => {
  if ('response' in input) {
    return (input.response as { header: z.infer<typeof providerHeaderSchema> }).header.resultCode;
  }
  if ('header' in input) {
    return (input.header as z.infer<typeof providerHeaderSchema>).resultCode;
  }
  return input.resultCode;
};

const readSuccessBody = (
  input: z.infer<typeof providerSuccessEnvelopeSchema>,
): Readonly<{ items: ProviderItems; totalCount: number | string }> => {
  if ('response' in input) {
    if ('data' in input.response) {
      return { items: input.response.data, totalCount: input.response.body.totalCount };
    }
    const body = input.response.body as ProviderBody;
    return {
      items: Object.hasOwn(body, 'items') ? body.items : body.data,
      totalCount: body.totalCount,
    };
  }
  if ('header' in input) {
    return {
      items: Object.hasOwn(input.body, 'items') ? input.body.items : input.body.data,
      totalCount: input.body.totalCount,
    };
  }
  return { items: input.data, totalCount: input.totalCount };
};

const parseProviderBody = (input: unknown): Readonly<{ rows: readonly ProviderRow[]; totalCount: number }> => {
  const headerResult = providerHeaderEnvelopeSchema.safeParse(input);
  if (!headerResult.success) {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response is invalid');
  }
  const resultCode = readHeaderCode(headerResult.data);
  if (resultCode !== 0 && resultCode !== '0') {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast provider returned a non-success result');
  }

  const responseResult = providerSuccessEnvelopeSchema.safeParse(input);
  if (!responseResult.success) {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response is invalid');
  }
  const body = readSuccessBody(responseResult.data);
  return { rows: toRows(body.items), totalCount: toCount(body.totalCount) };
};

const createForecastSlot = (now: number): Readonly<{ date: string; epochMs: number; hour: string }> => {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - KOREA_STANDARD_TIME_OFFSET_MS) {
    throw new RangeError('ITS road traffic forecast clock must return a valid epoch millisecond value');
  }
  const kst = new Date(now + KOREA_STANDARD_TIME_OFFSET_MS);
  if (Number.isNaN(kst.getTime())) {
    throw new RangeError('ITS road traffic forecast clock must return a valid epoch millisecond value');
  }
  const year = String(kst.getUTCFullYear()).padStart(4, '0');
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const hour = String(kst.getUTCHours()).padStart(2, '0');
  const localHourAsUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), kst.getUTCHours());
  return {
    date: `${year}${month}${day}`,
    epochMs: localHourAsUtc - KOREA_STANDARD_TIME_OFFSET_MS,
    hour,
  };
};

const assertResponseMetadata = (response: Response): void => {
  if (response.redirected) {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast redirect is not allowed');
  }
  if (response.url.length > 0) {
    let finalUrl: URL;
    try {
      finalUrl = new URL(response.url);
    } catch {
      throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast redirect is not allowed');
    }
    const expectedUrl = new URL(ITS_ROAD_TRAFFIC_FORECAST_ENDPOINT);
    if (finalUrl.origin !== expectedUrl.origin || finalUrl.pathname !== expectedUrl.pathname) {
      throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast redirect is not allowed');
    }
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response content type is invalid');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response size is invalid');
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > ITS_ROAD_TRAFFIC_FORECAST_MAX_RESPONSE_BYTES) {
      throw new ItsRoadTrafficForecastProviderError(
        'ITS road traffic forecast response size exceeds the allowed limit',
      );
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
    for (;;) {
      const next = await reader.read();
      if (signal.aborted) {
        throwAbortReason(signal);
      }
      if (next.done) {
        break;
      }
      receivedBytes += next.value.byteLength;
      if (receivedBytes > ITS_ROAD_TRAFFIC_FORECAST_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ItsRoadTrafficForecastProviderError(
          'ITS road traffic forecast response size exceeds the allowed limit',
        );
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ItsRoadTrafficForecastProviderError) {
      throw error;
    }
    if (signal.aborted) {
      throwAbortReason(signal);
    }
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response read failed');
  } finally {
    reader.releaseLock();
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
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response was not valid UTF-8');
  }
};

const normalizeResponse = (
  input: unknown,
  slot: Readonly<{ date: string; epochMs: number; hour: string }>,
  serviceKey: string,
): RoadTrafficForecastSnapshot => {
  const { rows, totalCount } = parseProviderBody(input);
  if (rows.length !== totalCount) {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response count is inconsistent');
  }

  const segments = rows.map((row) => {
    if (
      row.fcastDate !== slot.date ||
      row.fcastHour !== slot.hour ||
      row.sectionId !== ITS_ROAD_TRAFFIC_FORECAST_SECTION_ID
    ) {
      throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response scope is inconsistent');
    }
    const speed = toNumber(row.speed);
    const length = toNumber(row.length);
    if (row.linkId.includes(serviceKey)) {
      throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response is invalid');
    }
    if (speed < 0 || speed > 300 || length < 0 || length > 10_000_000) {
      throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response value is invalid');
    }
    return {
      linkId: row.linkId,
      sectionTypeCode: row.sectionType,
      speed,
      speedUnit: ROAD_TRAFFIC_FORECAST_SPEED_UNIT,
    };
  });
  segments.sort(compareRoadTrafficForecastSegments);

  const snapshotResult = roadTrafficForecastSnapshotSchema.safeParse({
    forecastAt: slot.epochMs,
    sectionId: ITS_ROAD_TRAFFIC_FORECAST_SECTION_ID,
    segments,
  });
  if (!snapshotResult.success) {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response is invalid');
  }
  return snapshotResult.data;
};

export async function fetchItsRoadTrafficForecast(
  options: FetchItsRoadTrafficForecastOptions,
): Promise<RoadTrafficForecastSnapshot> {
  const serviceKey = options.serviceKey.trim();
  if (serviceKey.length === 0) {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast credential is missing');
  }
  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }

  const slot = createForecastSlot(options.now);
  const url = new URL(ITS_ROAD_TRAFFIC_FORECAST_ENDPOINT);
  url.searchParams.set('apiKey', serviceKey);
  url.searchParams.set('sectionId', ITS_ROAD_TRAFFIC_FORECAST_SECTION_ID);
  url.searchParams.set('fCastDate', slot.date);
  url.searchParams.set('fCastHour', slot.hour);
  url.searchParams.set('getType', 'json');

  let response: Response;
  try {
    response = await options.fetcher(url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
    });
  } catch {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast request failed');
  }
  if (response.status !== 200) {
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast request returned a non-success status');
  }
  assertResponseMetadata(response);

  let input: unknown;
  try {
    const responseText = await readBoundedUtf8(response, options.signal);
    if (responseText.includes(serviceKey)) {
      throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response is invalid');
    }
    input = JSON.parse(responseText);
  } catch (error) {
    if (error instanceof ItsRoadTrafficForecastProviderError) {
      throw error;
    }
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new ItsRoadTrafficForecastProviderError('ITS road traffic forecast response was not valid JSON');
  }
  return normalizeResponse(input, slot, serviceKey);
}
