import { z } from 'zod';

import {
  EARTHQUAKE_BOUNDS,
  type EarthquakeSourceRef,
  earthquakeSourceRefSchema,
  earthquakeWindowSchema,
} from '../../../entities/earthquake/contract';

const KST_OFFSET_MS = 9 * 60 * 60_000;
const KMA_EARTHQUAKE_ENDPOINT = 'https://apis.data.go.kr/1360000/EqkInfoService/getEqkMsg';
const KMA_EARTHQUAKE_PAGE_SIZE = 100;
const KMA_EARTHQUAKE_MAX_RESULTS = 1_000;
const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const unsignedIntegerPattern = /^\d+$/;

const providerScalarSchema = z.union([z.string(), z.number().finite()]);
const optionalProviderScalarSchema = z.union([providerScalarSchema, z.null()]).optional();

const providerHeaderSchema = z
  .object({
    resultCode: providerScalarSchema,
    resultMsg: providerScalarSchema,
  })
  .strict();

const providerItemSchema = z
  .object({
    cnt: optionalProviderScalarSchema,
    cor: optionalProviderScalarSchema,
    dep: optionalProviderScalarSchema,
    fcTp: optionalProviderScalarSchema,
    img: optionalProviderScalarSchema,
    inT: optionalProviderScalarSchema,
    lat: providerScalarSchema,
    loc: providerScalarSchema,
    lon: providerScalarSchema,
    mt: optionalProviderScalarSchema,
    rem: optionalProviderScalarSchema,
    stnId: optionalProviderScalarSchema,
    tmEqk: providerScalarSchema,
    tmFc: providerScalarSchema,
    tmMsc: optionalProviderScalarSchema,
    tmSeq: optionalProviderScalarSchema,
  })
  .strict();

const providerItemsSchema = z.union([
  z
    .object({
      item: z.array(providerItemSchema),
    })
    .strict(),
  z.literal(''),
]);

const providerResponseSchema = z
  .object({
    response: z
      .object({
        body: z
          .object({
            dataType: z.literal('JSON'),
            items: providerItemsSchema,
            numOfRows: providerScalarSchema,
            pageNo: providerScalarSchema,
            totalCount: providerScalarSchema,
          })
          .strict(),
        header: providerHeaderSchema,
      })
      .strict(),
  })
  .strict();

type ProviderItem = z.infer<typeof providerItemSchema>;

type ParsedProviderPage = Readonly<{
  items: ProviderItem[];
  numOfRows: number;
  pageNo: number;
  totalCount: number;
}>;

export type EarthquakeWindow = Readonly<{ from: number; to: number }>;

export type FetchKmaEarthquakeRecordsOptions = Readonly<{
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
  window: EarthquakeWindow;
}>;

class KmaEarthquakeProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KmaEarthquakeProviderError';
  }
}

const serializeScalar = (input: string | number): string => String(input).trim();

const parseUnsignedInteger = (input: string | number, label: string): number => {
  const serialized = serializeScalar(input);
  if (!unsignedIntegerPattern.test(serialized)) {
    throw new KmaEarthquakeProviderError(`KMA ${label} must be an unsigned integer`);
  }

  const value = Number(serialized);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new KmaEarthquakeProviderError(`KMA ${label} must be an unsigned integer`);
  }
  return value;
};

const parseProviderPage = (input: unknown): ParsedProviderPage => {
  let parsed: z.infer<typeof providerResponseSchema>;
  try {
    parsed = providerResponseSchema.parse(input);
  } catch (error) {
    throw new KmaEarthquakeProviderError('KMA earthquake response is invalid', error);
  }

  const code = serializeScalar(parsed.response.header.resultCode);
  if (code !== '00' && code !== '0') {
    throw new KmaEarthquakeProviderError('KMA earthquake provider returned a non-success result');
  }

  const body = parsed.response.body;
  return {
    items: body.items === '' ? [] : body.items.item,
    numOfRows: parseUnsignedInteger(body.numOfRows, 'page size'),
    pageNo: parseUnsignedInteger(body.pageNo, 'page number'),
    totalCount: parseUnsignedInteger(body.totalCount, 'total count'),
  };
};

const parseFiniteNumber = (input: string | number, label: string): number => {
  const serialized = serializeScalar(input);
  if (!numericPattern.test(serialized)) {
    throw new KmaEarthquakeProviderError(`KMA ${label} is invalid`);
  }

  const value = Number(serialized);
  if (!Number.isFinite(value)) {
    throw new KmaEarthquakeProviderError(`KMA ${label} is invalid`);
  }
  return value;
};

const parseOptionalNumber = (input: string | number | null | undefined, label: string): number | null => {
  if (input === null || input === undefined || serializeScalar(input).length === 0) {
    return null;
  }
  return parseFiniteNumber(input, label);
};

const parseOptionalText = (input: string | number | null | undefined): string | null => {
  if (input === null || input === undefined) {
    return null;
  }
  const value = serializeScalar(input);
  return value.length === 0 ? null : value;
};

const parseRequiredText = (input: string | number, label: string): string => {
  const value = serializeScalar(input);
  if (value.length === 0) {
    throw new KmaEarthquakeProviderError(`KMA ${label} is missing`);
  }
  return value;
};

const parseKstTimestamp = (
  input: string | number,
  label: string,
  millisecondsInput?: string | number | null,
): number => {
  const serialized = serializeScalar(input);
  if (!/^\d{12}(?:\d{2})?$/.test(serialized)) {
    throw new KmaEarthquakeProviderError(`KMA ${label} timestamp is invalid`);
  }

  const year = Number(serialized.slice(0, 4));
  const month = Number(serialized.slice(4, 6));
  const day = Number(serialized.slice(6, 8));
  const hour = Number(serialized.slice(8, 10));
  const minute = Number(serialized.slice(10, 12));
  const second = serialized.length === 14 ? Number(serialized.slice(12, 14)) : 0;
  let milliseconds = 0;
  if (millisecondsInput !== null && millisecondsInput !== undefined) {
    const rawMilliseconds = serializeScalar(millisecondsInput);
    if (!/^\d{1,3}$/.test(rawMilliseconds)) {
      throw new KmaEarthquakeProviderError(`KMA ${label} milliseconds are invalid`);
    }
    milliseconds = Number(rawMilliseconds.padStart(3, '0'));
  }

  const utcCalendarValue = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const calendar = new Date(utcCalendarValue);
  if (
    year < 2000 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    throw new KmaEarthquakeProviderError(`KMA ${label} timestamp is invalid`);
  }

  return utcCalendarValue - KST_OFFSET_MS;
};

const assertGlobalCoordinate = (value: number, axis: 'latitude' | 'longitude'): void => {
  const [minimum, maximum] = axis === 'latitude' ? [-90, 90] : [-180, 180];
  if (value < minimum || value > maximum) {
    throw new KmaEarthquakeProviderError(`KMA ${axis} is invalid`);
  }
};

const isInApprovedBounds = (latitude: number, longitude: number): boolean =>
  latitude >= EARTHQUAKE_BOUNDS.minimumLatitude &&
  latitude <= EARTHQUAKE_BOUNDS.maximumLatitude &&
  longitude >= EARTHQUAKE_BOUNDS.minimumLongitude &&
  longitude <= EARTHQUAKE_BOUNDS.maximumLongitude;

const normalizeOptionalIdPart = (input: string | number | null | undefined): string | undefined => {
  const value = parseOptionalText(input);
  return value === null ? undefined : value;
};

const normalizeProviderItem = (item: ProviderItem, window: EarthquakeWindow): EarthquakeSourceRef | undefined => {
  const latitude = parseFiniteNumber(item.lat, 'latitude');
  const longitude = parseFiniteNumber(item.lon, 'longitude');
  assertGlobalCoordinate(latitude, 'latitude');
  assertGlobalCoordinate(longitude, 'longitude');

  const occurredAt = parseKstTimestamp(item.tmEqk, 'occurrence', item.tmMsc);
  if (occurredAt < window.from || occurredAt > window.to || !isInApprovedBounds(latitude, longitude)) {
    return undefined;
  }

  const updatedAt = parseKstTimestamp(item.tmFc, 'publication');
  const stationId = normalizeOptionalIdPart(item.stnId);
  const sequence = normalizeOptionalIdPart(item.tmSeq);
  const count = normalizeOptionalIdPart(item.cnt);
  const publicationMonth = serializeScalar(item.tmFc).slice(0, 6);
  const id =
    stationId !== undefined && sequence !== undefined
      ? `${stationId}:${publicationMonth}:${sequence}`
      : `${serializeScalar(item.tmEqk)}:${latitude}:${longitude}`;
  const alias = `${stationId ?? 'na'}:${sequence ?? 'na'}:${serializeScalar(item.tmFc)}:${count ?? 'na'}`;

  try {
    return earthquakeSourceRefSchema.parse({
      aliases: [alias],
      depthKm: parseOptionalNumber(item.dep, 'depth'),
      id,
      intensity: parseOptionalText(item.inT),
      latitude,
      location: parseRequiredText(item.loc, 'location'),
      longitude,
      magnitude: parseOptionalNumber(item.mt, 'magnitude'),
      magnitudeType: null,
      occurredAt,
      provider: 'KMA',
      updatedAt,
    });
  } catch (error) {
    if (error instanceof KmaEarthquakeProviderError) {
      throw error;
    }
    throw new KmaEarthquakeProviderError('Normalized KMA earthquake record is invalid', error);
  }
};

const collapseKmaCorrections = (records: readonly EarthquakeSourceRef[]): EarthquakeSourceRef[] => {
  const grouped = new Map<string, EarthquakeSourceRef[]>();
  for (const record of records) {
    const group = grouped.get(record.id) ?? [];
    group.push(record);
    grouped.set(record.id, group);
  }

  return [...grouped.values()]
    .map((group) => {
      const latest = [...group].sort(
        (left, right) => right.updatedAt - left.updatedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )[0];
      if (latest === undefined) {
        throw new KmaEarthquakeProviderError('KMA correction group is empty');
      }

      const aliases = [...new Set(group.flatMap((record) => record.aliases))].sort();
      return earthquakeSourceRefSchema.parse({ ...latest, aliases });
    })
    .sort((left, right) => right.occurredAt - left.occurredAt || (left.id < right.id ? -1 : 1));
};

export function normalizeKmaEarthquakePages(input: readonly unknown[], windowInput: EarthquakeWindow) {
  let window: EarthquakeWindow;
  try {
    window = earthquakeWindowSchema.parse(windowInput);
  } catch (error) {
    throw new KmaEarthquakeProviderError('KMA earthquake source window is invalid', error);
  }

  if (input.length === 0) {
    throw new KmaEarthquakeProviderError('KMA earthquake response has no pages');
  }

  const pages = input.map(parseProviderPage);
  const firstPage = pages[0];
  if (firstPage === undefined) {
    throw new KmaEarthquakeProviderError('KMA earthquake response has no first page');
  }
  if (firstPage.totalCount > KMA_EARTHQUAKE_MAX_RESULTS) {
    throw new KmaEarthquakeProviderError('KMA earthquake result exceeds the supported bound');
  }

  const expectedPageCount = Math.max(1, Math.ceil(firstPage.totalCount / KMA_EARTHQUAKE_PAGE_SIZE));
  if (pages.length !== expectedPageCount) {
    throw new KmaEarthquakeProviderError('KMA earthquake pagination is incomplete');
  }

  pages.forEach((page, index) => {
    if (
      page.numOfRows !== KMA_EARTHQUAKE_PAGE_SIZE ||
      page.pageNo !== index + 1 ||
      page.totalCount !== firstPage.totalCount
    ) {
      throw new KmaEarthquakeProviderError('KMA earthquake pagination metadata is invalid');
    }
  });

  const items = pages.flatMap((page) => page.items);
  if (items.length !== firstPage.totalCount) {
    throw new KmaEarthquakeProviderError('KMA earthquake pagination count does not match its items');
  }

  const seenAliases = new Set<string>();
  const records = items.flatMap((item) => {
    const record = normalizeProviderItem(item, window);
    if (record === undefined) {
      return [];
    }
    const alias = record.aliases[0];
    if (alias === undefined || seenAliases.has(alias)) {
      throw new KmaEarthquakeProviderError('KMA earthquake response contains a duplicate notice');
    }
    seenAliases.add(alias);
    return [record];
  });

  try {
    return collapseKmaCorrections(records);
  } catch (error) {
    if (error instanceof KmaEarthquakeProviderError) {
      throw error;
    }
    throw new KmaEarthquakeProviderError('KMA earthquake corrections are invalid', error);
  }
}

const normalizeServiceKey = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new TypeError('KMA earthquake service key must not be empty');
  }
  if (!/%[0-9a-f]{2}/i.test(trimmed)) {
    return trimmed;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    throw new KmaEarthquakeProviderError('KMA earthquake service key encoding is invalid');
  }
};

const formatKstDate = (epochMs: number): string => {
  const date = new Date(epochMs + KST_OFFSET_MS);
  if (Number.isNaN(date.getTime())) {
    throw new KmaEarthquakeProviderError('KMA earthquake source date is invalid');
  }
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
};

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const fetchProviderPage = async (
  options: FetchKmaEarthquakeRecordsOptions,
  serviceKey: string,
  pageNo: number,
): Promise<unknown> => {
  const url = new URL(KMA_EARTHQUAKE_ENDPOINT);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('numOfRows', String(KMA_EARTHQUAKE_PAGE_SIZE));
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('dataType', 'JSON');
  url.searchParams.set('fromTmFc', formatKstDate(options.window.from));
  url.searchParams.set('toTmFc', formatKstDate(options.window.to));

  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }

  let response: Response;
  try {
    response = await options.fetcher(url, { method: 'GET', redirect: 'error', signal: options.signal });
  } catch (error) {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new KmaEarthquakeProviderError('KMA earthquake request failed', error);
  }

  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }
  if (!response.ok) {
    throw new KmaEarthquakeProviderError('KMA earthquake request returned a non-success status');
  }

  try {
    return await response.json();
  } catch (error) {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new KmaEarthquakeProviderError('KMA earthquake response was not valid JSON', error);
  }
};

export async function fetchKmaEarthquakeRecords(
  options: FetchKmaEarthquakeRecordsOptions,
): Promise<EarthquakeSourceRef[]> {
  let window: EarthquakeWindow;
  try {
    window = earthquakeWindowSchema.parse(options.window);
  } catch (error) {
    throw new KmaEarthquakeProviderError('KMA earthquake source window is invalid', error);
  }
  const normalizedOptions = { ...options, window };
  const serviceKey = normalizeServiceKey(options.serviceKey);
  const first = await fetchProviderPage(normalizedOptions, serviceKey, 1);
  const firstPage = parseProviderPage(first);
  if (
    firstPage.pageNo !== 1 ||
    firstPage.numOfRows !== KMA_EARTHQUAKE_PAGE_SIZE ||
    firstPage.totalCount > KMA_EARTHQUAKE_MAX_RESULTS
  ) {
    throw new KmaEarthquakeProviderError('KMA earthquake pagination metadata is invalid');
  }

  const pageCount = Math.max(1, Math.ceil(firstPage.totalCount / KMA_EARTHQUAKE_PAGE_SIZE));
  const pages: unknown[] = [first];
  for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
    pages.push(await fetchProviderPage(normalizedOptions, serviceKey, pageNo));
  }

  return normalizeKmaEarthquakePages(pages, window);
}

export function readKmaEarthquakeCredential(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const credential = environment.KOREA_EARTHQUAKE_KEY?.trim() ?? '';
  return credential.length === 0 ? undefined : credential;
}
