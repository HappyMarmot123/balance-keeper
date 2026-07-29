import { z } from 'zod';

import {
  AIR_QUALITY_REGIONS,
  type AirPollutant,
  type AirQualityRegionId,
  airQualityDataSchema,
  classifyAirQualityGrade,
  MAX_AIR_QUALITY_CONCENTRATION,
} from '../../../entities/air-quality/contract';

const KST_OFFSET_MS = 9 * 60 * 60_000;
const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

const providerHeaderSchema = z
  .object({
    resultCode: z.string(),
    resultMsg: z.string(),
  })
  .strict();

const providerEnvelopeHeaderSchema = z
  .object({
    response: z
      .object({
        header: providerHeaderSchema,
      })
      .passthrough(),
  })
  .passthrough();

const providerScalarSchema = z.union([z.string(), z.number().finite(), z.null()]);
const optionalProviderScalarSchema = providerScalarSchema.optional();
const providerPmValueSchema = z.union([
  z.string().max(10),
  z.number().finite().max(MAX_AIR_QUALITY_CONCENTRATION),
  z.null(),
]);

const measurementItemSchema = z
  .object({
    coFlag: optionalProviderScalarSchema,
    coGrade: optionalProviderScalarSchema,
    coValue: optionalProviderScalarSchema,
    dataTime: z.string(),
    khaiGrade: optionalProviderScalarSchema,
    khaiValue: optionalProviderScalarSchema,
    mangName: z.string().min(1),
    no2Flag: optionalProviderScalarSchema,
    no2Grade: optionalProviderScalarSchema,
    no2Value: optionalProviderScalarSchema,
    o3Flag: optionalProviderScalarSchema,
    o3Grade: optionalProviderScalarSchema,
    o3Value: optionalProviderScalarSchema,
    pm10Flag: optionalProviderScalarSchema,
    pm10Grade: optionalProviderScalarSchema,
    pm10Grade1h: optionalProviderScalarSchema,
    pm10Value: providerPmValueSchema,
    pm10Value24: optionalProviderScalarSchema,
    pm25Flag: optionalProviderScalarSchema,
    pm25Grade: optionalProviderScalarSchema,
    pm25Grade1h: optionalProviderScalarSchema,
    pm25Value: providerPmValueSchema,
    pm25Value24: optionalProviderScalarSchema,
    sidoName: z.string().min(1),
    so2Flag: optionalProviderScalarSchema,
    so2Grade: optionalProviderScalarSchema,
    so2Value: optionalProviderScalarSchema,
    stationCode: optionalProviderScalarSchema,
    stationName: z.string().min(1),
  })
  .strict();

const stationItemSchema = z
  .object({
    addr: z.string().min(1),
    dmX: z.union([z.string(), z.number().finite()]),
    dmY: z.union([z.string(), z.number().finite()]),
    item: optionalProviderScalarSchema,
    mangName: z.string().min(1),
    stationCode: optionalProviderScalarSchema,
    stationName: z.string().min(1),
    year: optionalProviderScalarSchema,
  })
  .strict();

const createProviderSuccessSchema = <ItemSchema extends z.ZodType>(itemSchema: ItemSchema) =>
  z
    .object({
      response: z
        .object({
          header: providerHeaderSchema,
          body: z
            .object({
              items: z.array(itemSchema),
              numOfRows: z.number().int().positive(),
              pageNo: z.number().int().positive(),
              totalCount: z.number().int().nonnegative(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict();

const measurementSuccessSchema = createProviderSuccessSchema(measurementItemSchema);
const stationSuccessSchema = createProviderSuccessSchema(stationItemSchema);

class AirKoreaProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AirKoreaProviderError';
  }
}

export type AirKoreaConfig = Readonly<{
  measurementBaseUrl: string;
  measurementKey: string;
  stationBaseUrl: string;
  stationKey: string;
}>;

const readTrimmed = (environment: Readonly<Record<string, string | undefined>>, name: string): string =>
  environment[name]?.trim() ?? '';

const normalizeProviderBase = (input: string, expectedPath: string): string | undefined => {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'apis.data.go.kr' ||
    url.port.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    normalizedPath !== expectedPath ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return undefined;
  }

  return `${url.origin}${normalizedPath}`;
};

export function readAirKoreaConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AirKoreaConfig | undefined {
  const serviceKey = readTrimmed(environment, 'DATA_GO_KR_SERVICE_KEY');
  const measurementBase = readTrimmed(environment, 'KOREA_AIR_QUALITY_BASE_URL');
  const stationBase = readTrimmed(environment, 'KOREA_AIR_STATION_BASE_URL');

  if (serviceKey.length === 0 || measurementBase.length === 0 || stationBase.length === 0) {
    return undefined;
  }

  const measurementBaseUrl = normalizeProviderBase(measurementBase, '/B552584/ArpltnInforInqireSvc');
  const stationBaseUrl = normalizeProviderBase(stationBase, '/B552584/MsrstnInfoInqireSvc');
  if (measurementBaseUrl === undefined || stationBaseUrl === undefined) {
    return undefined;
  }

  return {
    measurementBaseUrl,
    measurementKey: serviceKey,
    stationBaseUrl,
    stationKey: serviceKey,
  };
}

export type FetchAirKoreaInputsOptions = Readonly<{
  config: AirKoreaConfig;
  fetcher: typeof fetch;
  providerRegionName: string;
  signal: AbortSignal;
}>;

const normalizeServiceKey = (input: string): string => {
  if (!/%[0-9a-f]{2}/i.test(input)) {
    return input;
  }

  try {
    return decodeURIComponent(input);
  } catch {
    throw new AirKoreaProviderError('AirKorea service key encoding is invalid');
  }
};

const createProviderUrl = (
  baseUrl: string,
  operation: string,
  serviceKey: string,
  parameters: Readonly<Record<string, string>>,
): URL => {
  const url = new URL(`${baseUrl}/${operation}`);
  url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }
  return url;
};

const fetchProviderJson = async (fetcher: typeof fetch, url: URL, signal: AbortSignal): Promise<unknown> => {
  if (signal.aborted) {
    throw signal.reason;
  }

  let response: Response;
  try {
    response = await fetcher(url, { method: 'GET', redirect: 'error', signal });
  } catch {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw new AirKoreaProviderError('AirKorea request failed');
  }

  if (!response.ok) {
    throw new AirKoreaProviderError('AirKorea request returned a non-success status');
  }

  try {
    return await response.json();
  } catch {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw new AirKoreaProviderError('AirKorea response was not valid JSON');
  }
};

export async function fetchAirKoreaInputs(
  options: FetchAirKoreaInputsOptions,
): Promise<Readonly<{ measurement: unknown; stationDirectory: unknown }>> {
  const measurementUrl = createProviderUrl(
    options.config.measurementBaseUrl,
    'getCtprvnRltmMesureDnsty',
    options.config.measurementKey,
    {
      numOfRows: '100',
      pageNo: '1',
      returnType: 'json',
      sidoName: options.providerRegionName,
      ver: '1.5',
    },
  );
  const stationUrl = createProviderUrl(options.config.stationBaseUrl, 'getMsrstnList', options.config.stationKey, {
    addr: options.providerRegionName,
    numOfRows: '100',
    pageNo: '1',
    returnType: 'json',
  });
  const [measurement, stationDirectory] = await Promise.allSettled([
    fetchProviderJson(options.fetcher, measurementUrl, options.signal),
    fetchProviderJson(options.fetcher, stationUrl, options.signal),
  ]);

  if (options.signal.aborted) {
    throw options.signal.reason;
  }
  if (measurement.status === 'rejected' || stationDirectory.status === 'rejected') {
    throw new AirKoreaProviderError('AirKorea joined request failed');
  }

  return {
    measurement: measurement.value,
    stationDirectory: stationDirectory.value,
  };
}

const parseProviderSuccess = <Schema extends z.ZodType>(input: unknown, schema: Schema, label: string) => {
  let header: z.infer<typeof providerHeaderSchema>;

  try {
    header = providerEnvelopeHeaderSchema.parse(input).response.header;
  } catch (error) {
    throw new AirKoreaProviderError(`AirKorea ${label} response header is invalid`, error);
  }

  if (header.resultCode !== '00') {
    throw new AirKoreaProviderError(`AirKorea ${label} provider returned a non-success result`);
  }

  try {
    return schema.parse(input);
  } catch (error) {
    throw new AirKoreaProviderError(`AirKorea ${label} response body is invalid`, error);
  }
};

const assertSinglePage = (
  body: Readonly<{ items: readonly unknown[]; numOfRows: number; pageNo: number; totalCount: number }>,
  label: string,
): void => {
  if (body.pageNo !== 1 || body.numOfRows !== 100 || body.totalCount > 100 || body.totalCount !== body.items.length) {
    throw new AirKoreaProviderError(`AirKorea ${label} pagination is invalid`);
  }
};

const normalizeJoinPart = (value: string): string => value.trim().normalize('NFC').replace(/\s+/g, ' ');
const createJoinKey = (stationName: string, networkName: string): string =>
  `${normalizeJoinPart(stationName)}\u0000${normalizeJoinPart(networkName)}`;

const parseKstTimestamp = (value: string): number => {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2})$/.exec(value);
  if (match?.groups === undefined) {
    throw new AirKoreaProviderError('AirKorea observation timestamp is invalid');
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const calendarValue = Date.UTC(year, month - 1, day, hour, minute);
  const calendar = new Date(calendarValue);
  if (
    year < 2000 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute
  ) {
    throw new AirKoreaProviderError('AirKorea observation timestamp is invalid');
  }

  return calendarValue - KST_OFFSET_MS;
};

const parseFiniteNumber = (input: string | number, label: string): number => {
  const serialized = typeof input === 'number' ? String(input) : input.trim();
  if (!numericPattern.test(serialized)) {
    throw new AirKoreaProviderError(`AirKorea ${label} value is invalid`);
  }

  const value = Number(serialized);
  if (!Number.isFinite(value)) {
    throw new AirKoreaProviderError(`AirKorea ${label} value is invalid`);
  }
  return value;
};

const parseConcentration = (
  input: string | number | null,
  pollutant: AirPollutant,
):
  | { concentration: number; grade: ReturnType<typeof classifyAirQualityGrade> }
  | {
      concentration: null;
      grade: null;
    } => {
  if (input === null || (typeof input === 'string' && (input.trim() === '' || input.trim() === '-'))) {
    return { concentration: null, grade: null };
  }

  const concentration = parseFiniteNumber(input, pollutant);
  return {
    concentration,
    grade: classifyAirQualityGrade(pollutant, concentration),
  };
};

const parseCoordinate = (input: string | number, axis: 'latitude' | 'longitude'): number => {
  const value = parseFiniteNumber(input, axis);
  const [minimum, maximum] = axis === 'latitude' ? [32, 39] : [124, 132];
  if (value < minimum || value > maximum) {
    throw new AirKoreaProviderError(`AirKorea ${axis} is outside Korea bounds`);
  }
  return value;
};

export function normalizeAirKoreaSnapshot(
  measurementInput: unknown,
  stationInput: unknown,
  regionId: AirQualityRegionId,
) {
  const region = AIR_QUALITY_REGIONS[regionId];
  if (region === undefined) {
    throw new AirKoreaProviderError('AirKorea region is invalid');
  }

  const measurement = parseProviderSuccess(measurementInput, measurementSuccessSchema, 'measurement');
  const directory = parseProviderSuccess(stationInput, stationSuccessSchema, 'station directory');
  const measurementBody = measurement.response.body;
  const stationBody = directory.response.body;
  assertSinglePage(measurementBody, 'measurement');
  assertSinglePage(stationBody, 'station directory');

  const stationByKey = new Map<
    string,
    Readonly<{
      address: string;
      latitude: number;
      longitude: number;
      networkName: string;
      stationName: string;
    }>
  >();
  for (const station of stationBody.items) {
    const address = station.addr.trim();
    const networkName = normalizeJoinPart(station.mangName);
    const stationName = normalizeJoinPart(station.stationName);
    if (address.length === 0 || networkName.length === 0 || stationName.length === 0) {
      throw new AirKoreaProviderError('AirKorea station directory metadata is invalid');
    }
    if (!address.startsWith(region.providerName)) {
      throw new AirKoreaProviderError('AirKorea station directory region is invalid');
    }

    const key = createJoinKey(stationName, networkName);
    if (stationByKey.has(key)) {
      throw new AirKoreaProviderError('AirKorea station directory contains an ambiguous station');
    }
    stationByKey.set(key, {
      address,
      latitude: parseCoordinate(station.dmX, 'latitude'),
      longitude: parseCoordinate(station.dmY, 'longitude'),
      networkName,
      stationName,
    });
  }

  if (measurementBody.items.length === 0) {
    return null;
  }

  const measurementKeys = new Set<string>();
  const stations = measurementBody.items.map((measurementItem) => {
    if (measurementItem.sidoName !== region.providerName) {
      throw new AirKoreaProviderError('AirKorea measurement region does not match the selected region');
    }

    const key = createJoinKey(measurementItem.stationName, measurementItem.mangName);
    if (measurementKeys.has(key)) {
      throw new AirKoreaProviderError('AirKorea measurement contains a duplicate station');
    }
    measurementKeys.add(key);

    const station = stationByKey.get(key);
    if (station === undefined) {
      throw new AirKoreaProviderError('AirKorea station metadata is missing');
    }

    return {
      address: station.address,
      latitude: station.latitude,
      longitude: station.longitude,
      networkName: station.networkName,
      observedAt: parseKstTimestamp(measurementItem.dataTime),
      pm10: parseConcentration(measurementItem.pm10Value, 'pm10'),
      pm25: parseConcentration(measurementItem.pm25Value, 'pm25'),
      providerRegionName: measurementItem.sidoName,
      regionId,
      stationName: station.stationName,
    };
  });

  const normalized = {
    observedAt: Math.max(...stations.map((station) => station.observedAt)),
    observedStationCount: stations.filter(
      (station) => station.pm10.concentration !== null || station.pm25.concentration !== null,
    ).length,
    region: regionId,
    stations,
    totalStationCount: stations.length,
  };

  try {
    return airQualityDataSchema.parse(normalized);
  } catch (error) {
    throw new AirKoreaProviderError('Normalized AirKorea data is invalid', error);
  }
}
