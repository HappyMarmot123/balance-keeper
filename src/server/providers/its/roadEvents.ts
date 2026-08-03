import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  compareRoadEvents,
  ROAD_EVENT_MAX_EVENTS,
  ROAD_EVENT_MAX_GEOMETRY_POSITIONS,
  ROAD_EVENT_MAX_MESSAGE_LENGTH,
  ROAD_EVENT_SEVERITY,
  type RoadEvent,
  type RoadEventCategory,
  type RoadEventChannel,
  type RoadEventGeometry,
  type RoadEventPosition,
  type RoadEventSnapshot,
  roadEventSnapshotSchema,
} from '../../../entities/road-event/contract';

const ITS_OPEN_API_ORIGIN = 'https://openapi.its.go.kr:9443';
const INCIDENTS_PATHNAME = '/eventInfo';
const DISASTERS_PATHNAME = '/disasterInfo';
const KST_OFFSET_MS = 9 * 60 * 60_000;
const MAX_EPOCH_MS = 8_640_000_000_000_000;

export const ITS_ROAD_EVENTS_MAX_RESPONSE_BYTES = 512 * 1024;

const boundedTextSchema = (maximum: number) => z.string().max(maximum);
const providerTextSchema = boundedTextSchema(2_000);
const coordinateScalarSchema = z.union([z.number().finite(), z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u)]);
const countScalarSchema = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/u)]);
const resultCodeSchema = z.union([z.number().int().safe(), z.string().min(1).max(32)]);
const geometryTypeScalarSchema = z.union([z.number().int().min(1).max(3), z.enum(['1', '2', '3'])]);

const incidentRowSchema = z
  .object({
    coordX: coordinateScalarSchema,
    coordY: coordinateScalarSchema,
    endDate: boundedTextSchema(14).nullable(),
    eventDetailType: providerTextSchema,
    eventType: providerTextSchema.refine((value) => value.trim().length > 0),
    lanesBlocked: providerTextSchema,
    lanesBlockType: providerTextSchema,
    linkId: providerTextSchema,
    message: boundedTextSchema(ROAD_EVENT_MAX_MESSAGE_LENGTH),
    roadDrcType: providerTextSchema,
    roadName: providerTextSchema,
    roadNo: providerTextSchema,
    startDate: z.string().regex(/^\d{14}$/u),
    type: providerTextSchema,
  })
  .strict();

const disasterRowSchema = z
  .object({
    category: z.literal('D'),
    endDate: boundedTextSchema(14).nullable(),
    eventDetailType: providerTextSchema,
    eventId: providerTextSchema.refine((value) => value.trim().length > 0),
    eventType: providerTextSchema.refine((value) => value.trim().length > 0),
    lanesBlocked: providerTextSchema.nullable(),
    lanesBlockType: providerTextSchema,
    linkId: providerTextSchema,
    LocationInfo: providerTextSchema.optional(),
    locationGeometry: providerTextSchema.nullable().optional(),
    LocationInfoType: geometryTypeScalarSchema.optional(),
    locationInfo: providerTextSchema.optional(),
    locationInfoType: geometryTypeScalarSchema.optional(),
    message: boundedTextSchema(ROAD_EVENT_MAX_MESSAGE_LENGTH).refine((value) => value.trim().length > 0),
    roadDrcType: providerTextSchema.nullable().optional(),
    roadName: providerTextSchema,
    roadNo: providerTextSchema.nullable().optional(),
    socExtent: providerTextSchema.nullable(),
    socName: providerTextSchema,
    startDate: z.string().regex(/^\d{14}$/u),
    status: providerTextSchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    const lowercaseType = row.locationInfoType?.toString();
    const uppercaseType = row.LocationInfoType?.toString();
    if (lowercaseType === undefined && uppercaseType === undefined) {
      context.addIssue({ code: 'custom', message: 'Disaster geometry type is required', path: [] });
    } else if (lowercaseType !== undefined && uppercaseType !== undefined && lowercaseType !== uppercaseType) {
      context.addIssue({ code: 'custom', message: 'Disaster geometry type fields conflict', path: [] });
    }

    if (row.locationInfo === undefined && row.LocationInfo === undefined) {
      context.addIssue({ code: 'custom', message: 'Disaster geometry is required', path: [] });
    } else if (
      row.locationInfo !== undefined &&
      row.LocationInfo !== undefined &&
      row.locationInfo !== row.LocationInfo
    ) {
      context.addIssue({ code: 'custom', message: 'Disaster geometry fields conflict', path: [] });
    }

    if (row.locationGeometry !== undefined && row.locationGeometry !== null && row.locationGeometry.trim() !== '') {
      context.addIssue({ code: 'custom', message: 'Legacy disaster geometry must remain blank', path: [] });
    }
  });

type IncidentRow = z.infer<typeof incidentRowSchema>;
type DisasterRow = z.infer<typeof disasterRowSchema>;
type ProviderRow = IncidentRow | DisasterRow;

const providerHeaderSchema = z
  .object({
    resultCode: resultCodeSchema,
    resultMsg: boundedTextSchema(1_024),
  })
  .strict();

const createRowsSchema = <Schema extends z.ZodType<ProviderRow>>(rowSchema: Schema) =>
  z.union([rowSchema, z.array(rowSchema).max(ROAD_EVENT_MAX_EVENTS)]);

const createItemsSchema = <Schema extends z.ZodType<ProviderRow>>(rowSchema: Schema) => {
  const rowsSchema = createRowsSchema(rowSchema);
  return z.union([rowsSchema, z.object({ item: rowsSchema.nullable() }).strict(), z.object({}).strict()]);
};

const createBodySchema = <Schema extends z.ZodType<ProviderRow>>(rowSchema: Schema) => {
  const itemsSchema = createItemsSchema(rowSchema);
  return z
    .object({
      data: itemsSchema.nullable().optional(),
      items: itemsSchema.nullable().optional(),
      totalCount: countScalarSchema,
    })
    .strict()
    .superRefine((body, context) => {
      if (Object.hasOwn(body, 'data') && Object.hasOwn(body, 'items')) {
        context.addIssue({ code: 'custom', message: 'Provider body must use one item container', path: [] });
      }
    });
};

const createHeaderEnvelopeSchema = () =>
  z.union([
    z.object({ response: z.object({ header: providerHeaderSchema }).passthrough() }).passthrough(),
    z.object({ header: providerHeaderSchema }).passthrough(),
    z.object({ resultCode: resultCodeSchema, resultMsg: boundedTextSchema(1_024) }).passthrough(),
  ]);

const createSuccessEnvelopeSchema = <Schema extends z.ZodType<ProviderRow>>(rowSchema: Schema) => {
  const bodySchema = createBodySchema(rowSchema);
  const itemsSchema = createItemsSchema(rowSchema);
  return z.union([
    z.object({ body: bodySchema, header: providerHeaderSchema }).strict(),
    z.object({ response: z.object({ body: bodySchema, header: providerHeaderSchema }).strict() }).strict(),
    z
      .object({
        response: z
          .object({
            body: z.object({ totalCount: countScalarSchema }).strict(),
            data: itemsSchema.nullable().optional(),
            header: providerHeaderSchema,
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        data: itemsSchema.nullable().optional(),
        resultCode: resultCodeSchema,
        resultMsg: boundedTextSchema(1_024),
        totalCount: countScalarSchema,
      })
      .strict(),
  ]);
};

export type FetchItsRoadEventsOptions = Readonly<{
  fetcher: typeof fetch;
  now: number;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class ItsRoadEventsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItsRoadEventsProviderError';
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const toCount = (value: number | string): number => {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > ROAD_EVENT_MAX_EVENTS) {
    throw new ItsRoadEventsProviderError('ITS road events response count is invalid');
  }
  return count;
};

const toRows = <Row extends ProviderRow>(
  items: Row | readonly Row[] | { item: Row | readonly Row[] | null } | null | undefined,
): readonly Row[] => {
  if (items === undefined || items === null || (!Array.isArray(items) && Object.keys(items).length === 0)) {
    return [];
  }
  const rows = !Array.isArray(items) && 'item' in items ? items.item : items;
  if (rows === null) {
    return [];
  }
  return Array.isArray(rows) ? rows : [rows as Row];
};

const readHeaderCode = (input: unknown): number | string => {
  const result = createHeaderEnvelopeSchema().safeParse(input);
  if (!result.success) {
    throw new ItsRoadEventsProviderError('ITS road events response is invalid');
  }
  if ('response' in result.data) {
    return (result.data.response as { header: z.infer<typeof providerHeaderSchema> }).header.resultCode;
  }
  if ('header' in result.data) {
    return (result.data.header as z.infer<typeof providerHeaderSchema>).resultCode;
  }
  return result.data.resultCode;
};

const parseProviderBody = <Schema extends z.ZodType<ProviderRow>>(
  input: unknown,
  rowSchema: Schema,
): Readonly<{ rows: readonly z.infer<Schema>[]; totalCount: number }> => {
  const resultCode = readHeaderCode(input);
  if (resultCode !== 0 && resultCode !== '0') {
    throw new ItsRoadEventsProviderError('ITS road events provider returned a non-success result');
  }

  const result = createSuccessEnvelopeSchema(rowSchema).safeParse(input);
  if (!result.success) {
    throw new ItsRoadEventsProviderError('ITS road events response is invalid');
  }

  let totalCount: number | string;
  let items: unknown;
  if ('response' in result.data) {
    const response = result.data.response as {
      body: { data?: unknown; items?: unknown; totalCount: number | string };
      data?: unknown;
    };
    totalCount = response.body.totalCount;
    items = Object.hasOwn(response, 'data')
      ? response.data
      : Object.hasOwn(response.body, 'items')
        ? response.body.items
        : response.body.data;
  } else if ('header' in result.data) {
    totalCount = result.data.body.totalCount;
    items = Object.hasOwn(result.data.body, 'items') ? result.data.body.items : result.data.body.data;
  } else {
    totalCount = result.data.totalCount;
    items = result.data.data;
  }
  return {
    rows: toRows(
      items as
        | z.infer<Schema>
        | readonly z.infer<Schema>[]
        | { item: z.infer<Schema> | readonly z.infer<Schema>[] | null }
        | null
        | undefined,
    ),
    totalCount: toCount(totalCount),
  };
};

const assertValidNow = (now: number): void => {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_EPOCH_MS - KST_OFFSET_MS) {
    throw new RangeError('ITS road events clock must return a valid epoch millisecond value');
  }
};

const parseKstTimestamp = (value: string, allowMinutePrecision: boolean): number => {
  if (!/^\d{14}$/u.test(value) && !(allowMinutePrecision && /^\d{12}$/u.test(value))) {
    throw new ItsRoadEventsProviderError('ITS road events timestamp is invalid');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = value.length === 14 ? Number(value.slice(12, 14)) : 0;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const calendar = new Date(localAsUtc);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() + 1 !== month ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    throw new ItsRoadEventsProviderError('ITS road events timestamp is invalid');
  }
  const epoch = localAsUtc - KST_OFFSET_MS;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > MAX_EPOCH_MS) {
    throw new ItsRoadEventsProviderError('ITS road events timestamp is invalid');
  }
  return epoch;
};

const parseEndTimestamp = (value: string | null, allowMinutePrecision: boolean): number | null => {
  if (value === null || value.trim() === '') {
    return null;
  }
  return parseKstTimestamp(value, allowMinutePrecision);
};

const toPosition = (longitudeValue: number | string, latitudeValue: number | string): RoadEventPosition => {
  const longitude = typeof longitudeValue === 'number' ? longitudeValue : Number(longitudeValue);
  const latitude = typeof latitudeValue === 'number' ? latitudeValue : Number(latitudeValue);
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < 124 ||
    longitude > 132 ||
    latitude < 32 ||
    latitude > 40
  ) {
    throw new ItsRoadEventsProviderError('ITS road events coordinate is invalid');
  }
  return [longitude, latitude];
};

const coordinateTokenPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

const parseCoordinateSequence = (input: string): readonly RoadEventPosition[] => {
  if (/\b(?:POINT|LINESTRING|POLYGON)\b/iu.test(input)) {
    throw new ItsRoadEventsProviderError('ITS road events disaster geometry is invalid');
  }
  return input.split(',').map((pair) => {
    const tokens = pair.trim().split(/\s+/u);
    if (tokens.length !== 2 || !tokens.every((token) => coordinateTokenPattern.test(token))) {
      throw new ItsRoadEventsProviderError('ITS road events disaster geometry is invalid');
    }
    const longitude = tokens[0];
    const latitude = tokens[1];
    if (longitude === undefined || latitude === undefined) {
      throw new ItsRoadEventsProviderError('ITS road events disaster geometry is invalid');
    }
    return toPosition(longitude, latitude);
  });
};

const countDistinctPositions = (positions: readonly RoadEventPosition[]): number =>
  new Set(positions.map(([longitude, latitude]) => `${longitude}\u0000${latitude}`)).size;

const toDisasterGeometry = (row: DisasterRow): RoadEventGeometry => {
  const type = (row.locationInfoType ?? row.LocationInfoType)?.toString();
  const geometryText = row.locationInfo ?? row.LocationInfo;
  if (type === undefined || geometryText === undefined) {
    throw new ItsRoadEventsProviderError('ITS road events disaster geometry is invalid');
  }
  const positions = parseCoordinateSequence(geometryText);
  if (positions.length > ROAD_EVENT_MAX_GEOMETRY_POSITIONS) {
    throw new ItsRoadEventsProviderError('ITS road events disaster geometry is invalid');
  }
  if (type === '1' && positions.length === 1) {
    const position = positions[0];
    if (position === undefined) {
      throw new ItsRoadEventsProviderError('ITS road events disaster geometry is invalid');
    }
    return { kind: 'point', position };
  }
  if (type === '2' && positions.length >= 2 && countDistinctPositions(positions) >= 2) {
    return { kind: 'line', path: positions };
  }
  if (type === '3' && positions.length >= 3 && countDistinctPositions(positions) >= 3) {
    return { kind: 'area', ring: positions };
  }
  throw new ItsRoadEventsProviderError('ITS road events disaster geometry is invalid');
};

const incidentCategory = (eventType: string): RoadEventCategory => {
  switch (eventType.trim()) {
    case '공사':
      return 'roadwork';
    case '교통사고':
      return 'traffic-accident';
    case '기상':
      return 'weather';
    case '재난':
      return 'disaster';
    default:
      return 'other';
  }
};

const disasterCategory = (eventType: string): RoadEventCategory => {
  switch (eventType.trim()) {
    case 'D03':
      return 'flooding';
    case 'D04':
      return 'river-flood';
    case 'D06':
      return 'sinkhole';
    case 'D07':
      return 'wildfire';
    default:
      throw new ItsRoadEventsProviderError('ITS road events disaster category is invalid');
  }
};

const createId = (identity: string): string =>
  `its-road-event:${createHash('sha256').update(identity, 'utf8').digest('base64url').slice(0, 32)}`;

const lifecycleFor = (startsAt: number, endsAt: number | null, now: number): RoadEvent['lifecycle'] =>
  startsAt > now ? 'scheduled' : endsAt === null ? 'unknown' : 'active';

const isTerminalDisasterStatus = (eventType: string, status: string | null): boolean => {
  const normalizedStatus = status?.trim();
  if (normalizedStatus === undefined || normalizedStatus.length === 0) {
    return false;
  }

  switch (eventType.trim()) {
    case 'D03':
      return ['해제', '대치해제', '변경해제'].includes(normalizedStatus);
    case 'D06':
      return normalizedStatus === '3';
    case 'D07':
      return normalizedStatus === '2' || normalizedStatus === '3';
    default:
      return false;
  }
};

const normalizeIncident = (row: IncidentRow, now: number): RoadEvent | null => {
  const startsAt = parseKstTimestamp(row.startDate, false);
  const endsAt = parseEndTimestamp(row.endDate, false);
  if (endsAt !== null && endsAt <= startsAt) {
    throw new ItsRoadEventsProviderError('ITS road events timestamp is invalid');
  }
  if (endsAt !== null && endsAt <= now) {
    return null;
  }
  const geometry = { kind: 'point' as const, position: toPosition(row.coordX, row.coordY) };
  const message = row.message.trim() || null;
  // ITS incidents have no provider event ID. Keep this occurrence key limited to
  // fields that identify where and when the event began; mutable revisions are
  // deliberately excluded so simultaneous conflicts fail closed during dedupe.
  const identity = JSON.stringify([
    'incidents',
    row.type.trim(),
    row.eventType.trim(),
    row.eventDetailType.trim(),
    row.startDate,
    geometry.position,
    row.linkId.trim(),
  ]);
  return {
    category: incidentCategory(row.eventType),
    endsAt,
    geometry,
    id: createId(identity),
    lifecycle: lifecycleFor(startsAt, endsAt, now),
    message,
    severity: ROAD_EVENT_SEVERITY,
    startsAt,
  };
};

const normalizeDisaster = (row: DisasterRow, now: number, startDate: string, endDate: string): RoadEvent | null => {
  if (row.startDate.slice(0, 8) < startDate || row.startDate.slice(0, 8) > endDate) {
    throw new ItsRoadEventsProviderError('ITS road events response scope is inconsistent');
  }
  const startsAt = parseKstTimestamp(row.startDate, false);
  const endsAt = parseEndTimestamp(row.endDate, true);
  if (endsAt !== null && endsAt <= startsAt) {
    throw new ItsRoadEventsProviderError('ITS road events timestamp is invalid');
  }
  if ((endsAt !== null && endsAt <= now) || isTerminalDisasterStatus(row.eventType, row.status)) {
    return null;
  }
  return {
    category: disasterCategory(row.eventType),
    endsAt,
    geometry: toDisasterGeometry(row),
    id: createId(JSON.stringify(['disasters', row.eventId.trim()])),
    lifecycle: lifecycleFor(startsAt, endsAt, now),
    message: row.message.trim(),
    severity: ROAD_EVENT_SEVERITY,
    startsAt,
  };
};

const deduplicateAndSort = (events: readonly RoadEvent[]): readonly RoadEvent[] => {
  const byId = new Map<string, RoadEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new ItsRoadEventsProviderError('ITS road events identities conflict');
    }
    byId.set(event.id, event);
  }
  return [...byId.values()].sort(compareRoadEvents);
};

const assertResponseMetadata = (response: Response, pathname: string): void => {
  if (response.redirected) {
    throw new ItsRoadEventsProviderError('ITS road events redirect is not allowed');
  }
  if (response.url.length > 0) {
    try {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== ITS_OPEN_API_ORIGIN || finalUrl.pathname !== pathname) {
        throw new Error('unsafe final endpoint');
      }
    } catch {
      throw new ItsRoadEventsProviderError('ITS road events redirect is not allowed');
    }
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType === undefined || !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/u.test(contentType)) {
    throw new ItsRoadEventsProviderError('ITS road events response content type is invalid');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new ItsRoadEventsProviderError('ITS road events response size is invalid');
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > ITS_ROAD_EVENTS_MAX_RESPONSE_BYTES) {
      throw new ItsRoadEventsProviderError('ITS road events response size exceeds the allowed limit');
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
      if (receivedBytes > ITS_ROAD_EVENTS_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ItsRoadEventsProviderError('ITS road events response size exceeds the allowed limit');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ItsRoadEventsProviderError) {
      throw error;
    }
    if (signal.aborted) {
      throwAbortReason(signal);
    }
    throw new ItsRoadEventsProviderError('ITS road events response read failed');
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
    throw new ItsRoadEventsProviderError('ITS road events response was not valid UTF-8');
  }
};

const formatDate = (date: Date): string =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;

const createDisasterWindow = (now: number): Readonly<{ endDate: string; startDate: string }> => {
  const kst = new Date(now + KST_OFFSET_MS);
  const currentDay = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return {
    endDate: formatDate(new Date(currentDay)),
    startDate: formatDate(new Date(currentDay - 6 * 24 * 60 * 60_000)),
  };
};

const appendNationwideBounds = (url: URL): void => {
  url.searchParams.set('minX', '124');
  url.searchParams.set('maxX', '132');
  url.searchParams.set('minY', '32');
  url.searchParams.set('maxY', '40');
};

const createRequestUrl = (
  channel: RoadEventChannel,
  serviceKey: string,
  now: number,
): Readonly<{ disasterWindow?: Readonly<{ endDate: string; startDate: string }>; url: URL }> => {
  const pathname = channel === 'incidents' ? INCIDENTS_PATHNAME : DISASTERS_PATHNAME;
  const url = new URL(pathname, ITS_OPEN_API_ORIGIN);
  url.searchParams.set('apiKey', serviceKey);
  let disasterWindow: Readonly<{ endDate: string; startDate: string }> | undefined;
  if (channel === 'incidents') {
    url.searchParams.set('type', 'all');
    url.searchParams.set('eventType', 'all');
  } else {
    disasterWindow = createDisasterWindow(now);
    url.searchParams.set('category', 'D');
    url.searchParams.set('eventType', 'all');
    url.searchParams.set('startDate', disasterWindow.startDate);
    url.searchParams.set('endDate', disasterWindow.endDate);
  }
  appendNationwideBounds(url);
  url.searchParams.set('getType', 'json');
  return { disasterWindow, url };
};

const fetchRoadEvents = async (
  channel: RoadEventChannel,
  options: FetchItsRoadEventsOptions,
): Promise<RoadEventSnapshot> => {
  const serviceKey = options.serviceKey.trim();
  if (serviceKey.length === 0) {
    throw new ItsRoadEventsProviderError('ITS road events credential is missing');
  }
  assertValidNow(options.now);
  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }

  const request = createRequestUrl(channel, serviceKey, options.now);
  let response: Response;
  try {
    response = await options.fetcher(request.url, {
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
    throw new ItsRoadEventsProviderError('ITS road events request failed');
  }
  if (response.status !== 200) {
    throw new ItsRoadEventsProviderError('ITS road events request returned a non-success status');
  }
  const pathname = channel === 'incidents' ? INCIDENTS_PATHNAME : DISASTERS_PATHNAME;
  assertResponseMetadata(response, pathname);

  let input: unknown;
  try {
    const responseText = await readBoundedUtf8(response, options.signal);
    if (responseText.includes(serviceKey)) {
      throw new ItsRoadEventsProviderError('ITS road events response is invalid');
    }
    input = JSON.parse(responseText);
    if (JSON.stringify(input).includes(serviceKey)) {
      throw new ItsRoadEventsProviderError('ITS road events response is invalid');
    }
  } catch (error) {
    if (error instanceof ItsRoadEventsProviderError) {
      throw error;
    }
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new ItsRoadEventsProviderError('ITS road events response was not valid JSON');
  }

  let events: readonly RoadEvent[];
  if (channel === 'incidents') {
    const parsed = parseProviderBody(input, incidentRowSchema);
    if (parsed.rows.length !== parsed.totalCount) {
      throw new ItsRoadEventsProviderError('ITS road events response count is inconsistent');
    }
    events = parsed.rows.map((row) => normalizeIncident(row, options.now)).filter((event) => event !== null);
  } else {
    const parsed = parseProviderBody(input, disasterRowSchema);
    if (parsed.rows.length !== parsed.totalCount || request.disasterWindow === undefined) {
      throw new ItsRoadEventsProviderError('ITS road events response count is inconsistent');
    }
    events = parsed.rows
      .map((row) =>
        normalizeDisaster(
          row,
          options.now,
          request.disasterWindow?.startDate ?? '',
          request.disasterWindow?.endDate ?? '',
        ),
      )
      .filter((event) => event !== null);
  }

  const result = roadEventSnapshotSchema.safeParse({
    channel,
    events: deduplicateAndSort(events),
    generatedAt: options.now,
  });
  if (!result.success) {
    throw new ItsRoadEventsProviderError('ITS road events response is invalid');
  }
  return result.data;
};

export const fetchItsRoadIncidents = (options: FetchItsRoadEventsOptions): Promise<RoadEventSnapshot> =>
  fetchRoadEvents('incidents', options);

export const fetchItsRoadDisasters = (options: FetchItsRoadEventsOptions): Promise<RoadEventSnapshot> =>
  fetchRoadEvents('disasters', options);
