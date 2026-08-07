import { z } from 'zod';

import {
  compareRoadTrafficDetectorObservations,
  compareRoadTrafficDetectors,
  ROAD_TRAFFIC_DETECTOR_MAX_ID_LENGTH,
  ROAD_TRAFFIC_DETECTOR_MAX_LINKS,
  ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS,
  ROAD_TRAFFIC_DETECTOR_METRIC_UNIT,
  ROAD_TRAFFIC_DETECTOR_SOURCE_TIME_BASIS,
  type RoadTrafficDetector,
  type RoadTrafficDetectorObservation,
  type RoadTrafficDetectorSnapshot,
  roadTrafficDetectorDataSchema,
} from '../../../entities/road-traffic/contract';

const ITS_ROAD_TRAFFIC_DETECTOR_ENDPOINT = 'https://openapi.its.go.kr:9443/vdsInfo';
export const ITS_ROAD_TRAFFIC_DETECTOR_MAX_RESPONSE_BYTES = 6 * 1_024 * 1_024;

const boundedTextSchema = (maximum: number) => z.string().max(maximum);
const canonicalIdSchema = boundedTextSchema(ROAD_TRAFFIC_DETECTOR_MAX_ID_LENGTH)
  .min(1)
  .refine((value) => value.trim().length > 0 && value === value.trim());
const laneScalarSchema = z.union([z.number().int().min(0).max(32), z.string().regex(/^(?:0|[1-9]\d?)$/u)]);
const metricScalarSchema = z.union([z.number().finite(), z.string().regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/u)]);
const countScalarSchema = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/u)]);
const resultCodeSchema = z.union([z.number().int().safe(), z.string().min(1).max(32)]);

const providerRowSchema = z
  .object({
    colctedDate: z.string().regex(/^\d{14}$/u),
    laneNo: laneScalarSchema,
    linkIds: z.string().min(1).max(2_048),
    occupancy: z.union([metricScalarSchema, z.literal('')]),
    speed: metricScalarSchema,
    vdsId: canonicalIdSchema,
    volume: metricScalarSchema,
  })
  .strict();
const providerRowsSchema = z.union([
  providerRowSchema,
  z.array(providerRowSchema).max(ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS),
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

export type FetchItsRoadTrafficDetectorsOptions = Readonly<{
  fetcher: typeof fetch;
  now: number;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class ItsRoadTrafficDetectorProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItsRoadTrafficDetectorProviderError';
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const assertClock = (now: number): void => {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) {
    throw new RangeError('ITS road traffic detector clock must return a valid epoch millisecond value');
  }
};

const createRequestUrl = (serviceKey: string): URL => {
  const url = new URL(ITS_ROAD_TRAFFIC_DETECTOR_ENDPOINT);
  url.searchParams.set('apiKey', serviceKey);
  url.searchParams.set('getType', 'json');
  return url;
};

const assertResponseMetadata = (response: Response, requestUrl: URL): void => {
  if (response.redirected || (response.url.length > 0 && response.url !== requestUrl.href)) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector redirect is not allowed');
  }
  if (response.status !== 200) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector request returned a non-success status');
  }
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response content type is invalid');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/u.test(declared)) {
      throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response size is invalid');
    }
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes > ITS_ROAD_TRAFFIC_DETECTOR_MAX_RESPONSE_BYTES) {
      throw new ItsRoadTrafficDetectorProviderError(
        'ITS road traffic detector response size exceeds the allowed limit',
      );
    }
  }
};

const readBoundedBody = async (response: Response, signal: AbortSignal): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (signal.aborted) throwAbortReason(signal);
      if (next.done) break;
      received += next.value.byteLength;
      if (received > ITS_ROAD_TRAFFIC_DETECTOR_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ItsRoadTrafficDetectorProviderError(
          'ITS road traffic detector response size exceeds the allowed limit',
        );
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ItsRoadTrafficDetectorProviderError) throw error;
    if (signal.aborted) throwAbortReason(signal);
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response read failed');
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
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response was not valid UTF-8');
  }
  if (body.includes(serviceKey)) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response is invalid');
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response was not valid JSON');
  }
  if (containsCredential(input, serviceKey)) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response is invalid');
  }
  return input;
};

const toNumber = (value: number | string): number => (typeof value === 'number' ? value : Number(value));
const toCount = (value: number | string): number => {
  const count = toNumber(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response count is invalid');
  }
  return count;
};

const parseProviderBody = (input: unknown): readonly ProviderRow[] => {
  const result = providerEnvelopeSchema.safeParse(input);
  if (!result.success) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response is invalid');
  }
  if (result.data.header.resultCode !== 0 && result.data.header.resultCode !== '0') {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector provider returned a non-success result');
  }
  const rows = Array.isArray(result.data.body.items) ? result.data.body.items : [result.data.body.items];
  if (rows.length !== toCount(result.data.body.totalCount)) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response count is inconsistent');
  }
  return rows;
};

const parseLinks = (value: string): readonly string[] => {
  if (value !== value.trim()) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector links are invalid');
  }
  const links = value.split(',');
  if (links.length === 0 || links.length > ROAD_TRAFFIC_DETECTOR_MAX_LINKS) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector links are invalid');
  }
  const seen = new Set<string>();
  for (const link of links) {
    if (!/^\d{1,64}$/u.test(link) || seen.has(link)) {
      throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector links are invalid');
    }
    seen.add(link);
  }
  return links;
};

const parseMetric = (value: number | string, allowBlank: boolean): number | null => {
  if (allowBlank && value === '') return null;
  const metric = toNumber(value);
  if (!Number.isFinite(metric) || metric < -1 || metric > 1_000_000_000) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector metric is invalid');
  }
  return metric === -1 ? null : metric;
};

const normalizeRows = (rows: readonly ProviderRow[], generatedAt: number): RoadTrafficDetectorSnapshot => {
  type MutableGroup = {
    detectorId: string;
    linkedRoadSegmentIds: readonly string[];
    observations: Map<string, RoadTrafficDetectorObservation>;
  };
  const groups = new Map<string, MutableGroup>();
  for (const row of rows) {
    const links = parseLinks(row.linkIds);
    const lane = toNumber(row.laneNo);
    const speed = parseMetric(row.speed, false);
    if (speed !== null && speed > 300) {
      throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector metric is invalid');
    }
    const observation: RoadTrafficDetectorObservation = [
      lane,
      row.colctedDate,
      speed,
      parseMetric(row.volume, false),
      parseMetric(row.occupancy, true),
    ];
    const groupIdentity = `${row.vdsId}\u0000${links.join('\u0001')}`;
    const observationIdentity = `${lane}\u0000${row.colctedDate}`;
    const group = groups.get(groupIdentity) ?? {
      detectorId: row.vdsId,
      linkedRoadSegmentIds: links,
      observations: new Map<string, RoadTrafficDetectorObservation>(),
    };
    const existing = group.observations.get(observationIdentity);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(observation)) {
      throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector observation revisions conflict');
    }
    group.observations.set(observationIdentity, observation);
    groups.set(groupIdentity, group);
  }

  const detectors: RoadTrafficDetector[] = [...groups.values()].map((group) => ({
    detectorId: group.detectorId,
    linkedRoadSegmentIds: group.linkedRoadSegmentIds,
    observations: [...group.observations.values()].sort(compareRoadTrafficDetectorObservations),
  }));
  detectors.sort(compareRoadTrafficDetectors);
  const result = roadTrafficDetectorDataSchema.safeParse({
    detectors,
    generatedAt,
    occupancyUnit: ROAD_TRAFFIC_DETECTOR_METRIC_UNIT,
    sourceTimeBasis: ROAD_TRAFFIC_DETECTOR_SOURCE_TIME_BASIS,
    speedUnit: ROAD_TRAFFIC_DETECTOR_METRIC_UNIT,
    volumeUnit: ROAD_TRAFFIC_DETECTOR_METRIC_UNIT,
  });
  if (!result.success) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector response is invalid');
  }
  return result.data;
};

export async function fetchItsRoadTrafficDetectors(
  options: FetchItsRoadTrafficDetectorsOptions,
): Promise<RoadTrafficDetectorSnapshot> {
  const serviceKey = options.serviceKey.trim();
  if (serviceKey.length === 0) {
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector credential is missing');
  }
  assertClock(options.now);
  if (options.signal.aborted) throwAbortReason(options.signal);
  const requestUrl = createRequestUrl(serviceKey);

  let response: Response;
  try {
    response = await options.fetcher(requestUrl, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
    });
  } catch {
    if (options.signal.aborted) throwAbortReason(options.signal);
    throw new ItsRoadTrafficDetectorProviderError('ITS road traffic detector request failed');
  }

  assertResponseMetadata(response, requestUrl);
  const input = parseJson(await readBoundedBody(response, options.signal), serviceKey);
  return normalizeRows(parseProviderBody(input), options.now);
}
