import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  SAFETY_NOTICE_MAX_MESSAGE_LENGTH,
  type SafetyNoticeSnapshot,
  safetyNoticeSnapshotSchema,
  type VariableSpeedLimitSnapshot,
  VMS_GUIDANCE_MAX_LINE_LENGTH,
  VMS_GUIDANCE_MAX_LINES_PER_PAGE,
  type VmsGuidanceSnapshot,
  variableSpeedLimitSnapshotSchema,
  vmsGuidanceSnapshotSchema,
} from '../../../entities/road-guidance/contract';

const ITS_OPEN_API_ORIGIN = 'https://openapi.its.go.kr:9443';
const VMS_PATHNAME = '/vmsInfo';
const SAFETY_PATHNAME = '/posIncidentInfo';
const VSL_PATHNAME = '/vslInfo';
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const MAX_PROVIDER_TEXT_LENGTH = 2_048;
const MAX_CANONICAL_TYPE_LENGTH = 128;

export const ITS_ROAD_GUIDANCE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const ITS_ROAD_GUIDANCE_MAX_NORMALIZED_BYTES = 2 * 1024 * 1024;
export const ITS_ROAD_GUIDANCE_MAX_RAW_ROWS = 5_000;

const boundedTextSchema = (maximum: number) => z.string().max(maximum);
const nonBlankProviderTextSchema = boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH).refine(
  (value) => value.trim().length > 0,
);
const coordinateScalarSchema = z.union([z.number().finite(), z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u)]);
const numericScalarSchema = z.union([z.number().finite(), z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u)]);
const countScalarSchema = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/u)]);
const resultCodeSchema = z.union([z.number().int().safe(), z.string().min(1).max(32)]);
const timestampSchema = z.string().regex(/^\d{14}$/u);

const vmsRowSchema = z
  .object({
    coordX: coordinateScalarSchema,
    coordY: coordinateScalarSchema,
    createdDate: timestampSchema,
    message: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    messageNo: boundedTextSchema(2),
    roadDrcType: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    roadGrad: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    roadName: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    routeNo: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    vmsId: nonBlankProviderTextSchema,
  })
  .strict();

const safetyRowSchema = z
  .object({
    message: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    occrrncId: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    outbrkType: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    priority: boundedTextSchema(16),
    revRoadDrcType: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    revRouteName: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    revRouteNo: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    revStdLinkId: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    revX: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    revY: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    roadDrcType: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    routeName: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    routeNo: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    startStdLinkId: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    startX: coordinateScalarSchema,
    startY: coordinateScalarSchema,
    stepType: boundedTextSchema(16),
  })
  .strict();

const vslRowSchema = z
  .object({
    coordX: coordinateScalarSchema,
    coordY: coordinateScalarSchema,
    createdDate: timestampSchema,
    defLmtSpeed: numericScalarSchema,
    limitSpeed: numericScalarSchema,
    linkId: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    registedDate: timestampSchema,
    roadNo: boundedTextSchema(MAX_PROVIDER_TEXT_LENGTH),
    sectionCode: z.enum(['1', '2']),
    vslId: nonBlankProviderTextSchema,
  })
  .strict();

type VmsRow = z.infer<typeof vmsRowSchema>;
type SafetyRow = z.infer<typeof safetyRowSchema>;
type VslRow = z.infer<typeof vslRowSchema>;
type GuidanceRow = VmsRow | SafetyRow | VslRow;

const providerHeaderSchema = z
  .object({
    resultCode: resultCodeSchema,
    resultMsg: boundedTextSchema(1_024),
  })
  .strict();

const createProviderEnvelopeSchemas = <Row extends GuidanceRow>(rowSchema: z.ZodType<Row>) => {
  const rowsSchema = z.union([rowSchema, z.array(rowSchema).max(ITS_ROAD_GUIDANCE_MAX_RAW_ROWS)]);
  const itemsSchema = z.union([rowsSchema, z.object({ item: rowsSchema.nullable() }).strict(), z.object({}).strict()]);
  const bodySchema = z
    .object({
      items: itemsSchema.nullable(),
      totalCount: countScalarSchema,
    })
    .strict();
  const envelopeSchema = z
    .object({
      body: bodySchema,
      header: providerHeaderSchema,
    })
    .strict();

  return {
    header: z.union([
      z.object({ header: providerHeaderSchema }).passthrough(),
      z.object({ response: z.object({ header: providerHeaderSchema }).passthrough() }).passthrough(),
    ]),
    success: z.union([envelopeSchema, z.object({ response: envelopeSchema }).strict()]),
  };
};

const vmsEnvelopeSchemas = createProviderEnvelopeSchemas(vmsRowSchema);
const safetyEnvelopeSchemas = createProviderEnvelopeSchemas(safetyRowSchema);
const vslEnvelopeSchemas = createProviderEnvelopeSchemas(vslRowSchema);

type ProviderEnvelopeSchemas<Row extends GuidanceRow> = ReturnType<typeof createProviderEnvelopeSchemas<Row>>;

export type FetchItsRoadGuidanceOptions = Readonly<{
  fetcher?: typeof fetch;
  now: number;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class ItsRoadGuidanceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItsRoadGuidanceProviderError';
  }
}

const invalidResponse = (): never => {
  throw new ItsRoadGuidanceProviderError('ITS road guidance response is invalid');
};

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const assertNow = (now: number): void => {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_EPOCH_MS) {
    throw new RangeError('ITS road guidance clock must return a valid epoch millisecond value');
  }
};

const toNumber = (value: number | string): number => (typeof value === 'number' ? value : Number(value));

const toCount = (value: number | string): number => {
  const count = toNumber(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    return invalidResponse();
  }
  return count;
};

const isValidTimestamp = (value: string): boolean => {
  if (!/^\d{14}$/u.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day &&
    calendar.getUTCHours() === hour &&
    calendar.getUTCMinutes() === minute &&
    calendar.getUTCSeconds() === second
  );
};

const hasForbiddenPlainText = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      character === '<' ||
      character === '>' ||
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
};

const sanitizePlainText = (value: string, maximum: number, allowBlank = false): string => {
  if (hasForbiddenPlainText(value)) {
    return invalidResponse();
  }
  const canonical = value.trim().replace(/\s+/gu, ' ').normalize('NFC');
  if ((!allowBlank && canonical.length === 0) || canonical.length > maximum) {
    return invalidResponse();
  }
  return canonical;
};

const parseVmsLines = (message: string): readonly string[] => {
  if (hasForbiddenPlainText(message)) {
    return invalidResponse();
  }
  const lines = message
    .split('|')
    .map((line) => sanitizePlainText(line, VMS_GUIDANCE_MAX_LINE_LENGTH, true))
    .filter((line) => line.length > 0);
  if (lines.length > VMS_GUIDANCE_MAX_LINES_PER_PAGE) {
    return invalidResponse();
  }
  return lines;
};

const parseCanonicalCode = (value: string): number => {
  const canonical = value.trim();
  if (!/^\d{1,4}$/u.test(canonical)) {
    return invalidResponse();
  }
  const code = Number(canonical);
  if (!Number.isSafeInteger(code) || code < 0) {
    return invalidResponse();
  }
  return code;
};

const parseVmsPageOrder = (value: string): number => {
  if (!/^(?:[1-9]|1[0-6])$/u.test(value)) {
    return invalidResponse();
  }
  return Number(value);
};

type Position = readonly [longitude: number, latitude: number];

const isLongitude = (value: number): boolean => value >= 124 && value <= 132;
const isLatitude = (value: number): boolean => value >= 32 && value <= 40;

const parseKoreaPosition = (rawX: number | string, rawY: number | string, allowSwap: boolean): Position => {
  const x = toNumber(rawX);
  const y = toNumber(rawY);
  const direct = isLongitude(x) && isLatitude(y);
  const swapped = isLatitude(x) && isLongitude(y);
  if (direct === swapped || (!direct && (!allowSwap || !swapped))) {
    return invalidResponse();
  }
  return direct ? [x, y] : [y, x];
};

const hashIdentity = (namespace: string, parts: readonly unknown[]): string =>
  createHash('sha256')
    .update(JSON.stringify([namespace, ...parts]))
    .digest('base64url')
    .slice(0, 32);

const compareIds = (left: Readonly<{ id: string }>, right: Readonly<{ id: string }>): number => {
  if (left.id < right.id) {
    return -1;
  }
  return left.id > right.id ? 1 : 0;
};

const readHeaderCode = <Row extends GuidanceRow>(
  input: z.infer<ProviderEnvelopeSchemas<Row>['header']>,
): string | number =>
  'response' in input
    ? (input.response as { header: z.infer<typeof providerHeaderSchema> }).header.resultCode
    : input.header.resultCode;

const readSuccessBody = <Row extends GuidanceRow>(
  input: z.infer<ProviderEnvelopeSchemas<Row>['success']>,
): Readonly<{ items: unknown; totalCount: number | string }> => {
  const envelope = 'response' in input ? input.response : input;
  return envelope.body;
};

const toRows = <Row extends GuidanceRow>(items: unknown): readonly Row[] => {
  if (items === null || (typeof items === 'object' && !Array.isArray(items) && Object.keys(items).length === 0)) {
    return [];
  }
  const rows =
    typeof items === 'object' && items !== null && !Array.isArray(items) && 'item' in items
      ? (items as { item: unknown }).item
      : items;
  if (rows === null) {
    return [];
  }
  return (Array.isArray(rows) ? rows : [rows]) as readonly Row[];
};

const parseProviderEnvelope = <Row extends GuidanceRow>(
  input: unknown,
  schemas: ProviderEnvelopeSchemas<Row>,
): readonly Row[] => {
  const headerResult = schemas.header.safeParse(input);
  if (!headerResult.success) {
    return invalidResponse();
  }
  const code = readHeaderCode(headerResult.data);
  if (code !== 0 && code !== '0') {
    throw new ItsRoadGuidanceProviderError('ITS road guidance provider returned a non-success result');
  }
  const successResult = schemas.success.safeParse(input);
  if (!successResult.success) {
    return invalidResponse();
  }
  const body = readSuccessBody(successResult.data);
  const rows = toRows<Row>(body.items);
  if (rows.length !== toCount(body.totalCount)) {
    throw new ItsRoadGuidanceProviderError('ITS road guidance response count is inconsistent');
  }
  return rows;
};

const assertResponseMetadata = (response: Response, pathname: string): void => {
  if (response.redirected) {
    throw new ItsRoadGuidanceProviderError('ITS road guidance redirect is not allowed');
  }
  if (response.url.length > 0) {
    let finalUrl: URL;
    try {
      finalUrl = new URL(response.url);
    } catch {
      throw new ItsRoadGuidanceProviderError('ITS road guidance redirect is not allowed');
    }
    const expected = new URL(pathname, ITS_OPEN_API_ORIGIN);
    if (finalUrl.protocol !== 'https:' || finalUrl.origin !== expected.origin || finalUrl.pathname !== pathname) {
      throw new ItsRoadGuidanceProviderError('ITS road guidance redirect is not allowed');
    }
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ItsRoadGuidanceProviderError('ITS road guidance response content type is invalid');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new ItsRoadGuidanceProviderError('ITS road guidance response size is invalid');
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > ITS_ROAD_GUIDANCE_MAX_RESPONSE_BYTES) {
      throw new ItsRoadGuidanceProviderError('ITS road guidance response size exceeds the allowed limit');
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
        return throwAbortReason(signal);
      }
      if (next.done) {
        break;
      }
      receivedBytes += next.value.byteLength;
      if (receivedBytes > ITS_ROAD_GUIDANCE_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ItsRoadGuidanceProviderError('ITS road guidance response size exceeds the allowed limit');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ItsRoadGuidanceProviderError) {
      throw error;
    }
    if (signal.aborted) {
      return throwAbortReason(signal);
    }
    throw new ItsRoadGuidanceProviderError('ITS road guidance response read failed');
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
    throw new ItsRoadGuidanceProviderError('ITS road guidance response was not valid UTF-8');
  }
};

const assertNormalizedSize = (snapshot: unknown): void => {
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > ITS_ROAD_GUIDANCE_MAX_NORMALIZED_BYTES) {
    throw new ItsRoadGuidanceProviderError('ITS road guidance normalized response size exceeds the allowed limit');
  }
};

const normalizeVms = (rows: readonly VmsRow[], now: number): VmsGuidanceSnapshot => {
  type Group = {
    id: string;
    pages: Map<number, { lines: readonly string[]; rawSignature: string }>;
    position: Position;
    sourceTimestamp: string;
  };
  const groups = new Map<string, Group>();

  for (const row of rows) {
    if (!isValidTimestamp(row.createdDate)) {
      return invalidResponse();
    }
    const rawId = row.vmsId.trim();
    const position = parseKoreaPosition(row.coordX, row.coordY, true);
    const order = parseVmsPageOrder(row.messageNo);
    const lines = parseVmsLines(row.message);
    const rawSignature = JSON.stringify(row);
    const group = groups.get(rawId) ?? {
      id: `its-road-guidance:vms:${hashIdentity('vms', [rawId])}`,
      pages: new Map(),
      position,
      sourceTimestamp: row.createdDate,
    };
    if (group.position[0] !== position[0] || group.position[1] !== position[1]) {
      return invalidResponse();
    }
    const previous = group.pages.get(order);
    if (previous !== undefined) {
      if (previous.rawSignature !== rawSignature) {
        return invalidResponse();
      }
    } else {
      group.pages.set(order, { lines, rawSignature });
    }
    if (row.createdDate > group.sourceTimestamp) {
      group.sourceTimestamp = row.createdDate;
    }
    groups.set(rawId, group);
  }

  const items = [...groups.values()].map(({ id, pages, position, sourceTimestamp }) => {
    const sortedPages = [...pages.entries()].sort(([left], [right]) => left - right);
    if (sortedPages.some(([order], index) => order !== index + 1)) {
      return invalidResponse();
    }
    return {
      id,
      pages: sortedPages.map(([order, page]) => ({ lines: page.lines, order })),
      position,
      sourceTimestamp,
      timeBasis: 'provider-local-unspecified' as const,
    };
  });
  items.sort(compareIds);

  const result = vmsGuidanceSnapshotSchema.safeParse({ channel: 'vms', generatedAt: now, items });
  if (!result.success) {
    return invalidResponse();
  }
  assertNormalizedSize(result.data);
  return result.data;
};

const normalizeSafety = (rows: readonly SafetyRow[], now: number): SafetyNoticeSnapshot => {
  const itemsById = new Map<string, SafetyNoticeSnapshot['items'][number]>();
  const identityById = new Map<string, string>();

  for (const row of rows) {
    const position = parseKoreaPosition(row.startX, row.startY, false);
    const message = sanitizePlainText(row.message, SAFETY_NOTICE_MAX_MESSAGE_LENGTH);
    const providerType = sanitizePlainText(row.outbrkType, MAX_CANONICAL_TYPE_LENGTH);
    const providerStepCode = parseCanonicalCode(row.stepType);
    const providerPriorityCode = parseCanonicalCode(row.priority);
    const occurrenceId = row.occrrncId.trim();
    const startLinkId = sanitizePlainText(row.startStdLinkId, MAX_PROVIDER_TEXT_LENGTH, true);
    const identityParts = [
      startLinkId,
      position,
      providerType,
      message,
      providerStepCode,
      providerPriorityCode,
    ] as const;
    const identity = JSON.stringify(
      occurrenceId.length > 0 ? ['provider', occurrenceId, ...identityParts] : ['derived', ...identityParts],
    );
    const id = `its-road-guidance:safety-notice:${hashIdentity('safety-notice', [identity])}`;
    const item = { id, message, position, providerPriorityCode, providerStepCode, providerType };
    const previousIdentity = identityById.get(id);
    const previous = itemsById.get(id);
    if (
      previousIdentity !== undefined &&
      (previousIdentity !== identity || JSON.stringify(previous) !== JSON.stringify(item))
    ) {
      return invalidResponse();
    }
    identityById.set(id, identity);
    itemsById.set(id, item);
  }

  const items = [...itemsById.values()].sort(compareIds);
  const result = safetyNoticeSnapshotSchema.safeParse({ channel: 'safety-notices', generatedAt: now, items });
  if (!result.success) {
    return invalidResponse();
  }
  assertNormalizedSize(result.data);
  return result.data;
};

const normalizeVsl = (rows: readonly VslRow[], now: number): VariableSpeedLimitSnapshot => {
  const itemsByRawId = new Map<
    string,
    Readonly<{ item: VariableSpeedLimitSnapshot['items'][number]; rawSignature: string }>
  >();

  for (const row of rows) {
    if (!isValidTimestamp(row.createdDate) || !isValidTimestamp(row.registedDate)) {
      return invalidResponse();
    }
    const limitSpeed = toNumber(row.limitSpeed);
    const defaultLimitSpeed = toNumber(row.defLmtSpeed);
    if (limitSpeed < 0 || limitSpeed > 300 || defaultLimitSpeed < 0 || defaultLimitSpeed > 300) {
      return invalidResponse();
    }
    const rawId = row.vslId.trim();
    const item = {
      defaultLimitSpeed,
      id: `its-road-guidance:vsl:${hashIdentity('vsl', [rawId])}`,
      limitSpeed,
      linkId: sanitizePlainText(row.linkId, 128, true) || null,
      position: parseKoreaPosition(row.coordX, row.coordY, true),
      restrictionState: 'provider-unspecified' as const,
      roadClass: row.sectionCode === '1' ? ('expressway' as const) : ('national-road' as const),
      roadNumber: sanitizePlainText(row.roadNo, 64),
      sourceCreatedTimestamp: row.createdDate,
      sourceRegisteredTimestamp: row.registedDate,
      speedUnit: 'provider-unspecified' as const,
      timeBasis: 'provider-local-unspecified' as const,
    };
    const rawSignature = JSON.stringify(row);
    const previous = itemsByRawId.get(rawId);
    if (previous !== undefined) {
      if (previous.rawSignature !== rawSignature || JSON.stringify(previous.item) !== JSON.stringify(item)) {
        return invalidResponse();
      }
    } else {
      itemsByRawId.set(rawId, { item, rawSignature });
    }
  }

  const items = [...itemsByRawId.values()].map(({ item }) => item).sort(compareIds);
  const result = variableSpeedLimitSnapshotSchema.safeParse({
    channel: 'variable-speed-limits',
    generatedAt: now,
    items,
  });
  if (!result.success) {
    return invalidResponse();
  }
  assertNormalizedSize(result.data);
  return result.data;
};

type GuidanceSpec<Row extends GuidanceRow, Snapshot> = Readonly<{
  appendQuery?: (url: URL) => void;
  normalize: (rows: readonly Row[], now: number) => Snapshot;
  pathname: string;
  schemas: ProviderEnvelopeSchemas<Row>;
}>;

const fetchGuidance = async <Row extends GuidanceRow, Snapshot>(
  options: FetchItsRoadGuidanceOptions,
  spec: GuidanceSpec<Row, Snapshot>,
): Promise<Snapshot> => {
  const serviceKey = options.serviceKey.trim();
  if (serviceKey.length === 0) {
    throw new ItsRoadGuidanceProviderError('ITS road guidance credential is missing');
  }
  assertNow(options.now);
  if (options.signal.aborted) {
    return throwAbortReason(options.signal);
  }

  const url = new URL(spec.pathname, ITS_OPEN_API_ORIGIN);
  url.searchParams.set('apiKey', serviceKey);
  spec.appendQuery?.(url);
  url.searchParams.set('getType', 'json');
  const fetcher = options.fetcher ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetcher(url, {
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
      return throwAbortReason(options.signal);
    }
    throw new ItsRoadGuidanceProviderError('ITS road guidance request failed');
  }
  if (response.status !== 200) {
    throw new ItsRoadGuidanceProviderError('ITS road guidance request returned a non-success status');
  }
  assertResponseMetadata(response, spec.pathname);

  let input: unknown;
  try {
    const responseText = await readBoundedUtf8(response, options.signal);
    const escapedServiceKey = JSON.stringify(serviceKey).slice(1, -1);
    if (responseText.includes(serviceKey) || responseText.includes(escapedServiceKey)) {
      return invalidResponse();
    }
    input = JSON.parse(responseText);
    const serializedInput = JSON.stringify(input);
    if (serializedInput.includes(serviceKey) || serializedInput.includes(escapedServiceKey)) {
      return invalidResponse();
    }
  } catch (error) {
    if (error instanceof ItsRoadGuidanceProviderError) {
      throw error;
    }
    if (options.signal.aborted) {
      return throwAbortReason(options.signal);
    }
    throw new ItsRoadGuidanceProviderError('ITS road guidance response was not valid JSON');
  }

  const rows = parseProviderEnvelope(input, spec.schemas);
  return spec.normalize(rows, options.now);
};

export const fetchItsVmsGuidance = (options: FetchItsRoadGuidanceOptions): Promise<VmsGuidanceSnapshot> =>
  fetchGuidance(options, {
    normalize: normalizeVms,
    pathname: VMS_PATHNAME,
    schemas: vmsEnvelopeSchemas,
  });

export const fetchItsSafetyNotices = (options: FetchItsRoadGuidanceOptions): Promise<SafetyNoticeSnapshot> =>
  fetchGuidance(options, {
    appendQuery(url) {
      url.searchParams.set('minX', '124');
      url.searchParams.set('maxX', '132');
      url.searchParams.set('minY', '32');
      url.searchParams.set('maxY', '40');
    },
    normalize: normalizeSafety,
    pathname: SAFETY_PATHNAME,
    schemas: safetyEnvelopeSchemas,
  });

export const fetchItsVariableSpeedLimits = (
  options: FetchItsRoadGuidanceOptions,
): Promise<VariableSpeedLimitSnapshot> =>
  fetchGuidance(options, {
    normalize: normalizeVsl,
    pathname: VSL_PATHNAME,
    schemas: vslEnvelopeSchemas,
  });
