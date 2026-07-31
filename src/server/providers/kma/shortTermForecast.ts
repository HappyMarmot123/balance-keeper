import { z } from 'zod';

import { WEATHER_REGIONS, weatherForecastDataSchema } from '../../../entities/weather/contract';

const KST_OFFSET_MS = 9 * 60 * 60_000;
const PUBLICATION_SAFETY_LAG_MS = 20 * 60_000;
const HOUR_MS = 60 * 60_000;
const KMA_SHORT_TERM_FORECAST_ENDPOINT = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const KMA_FORECAST_PAGE_NO = 1;
const KMA_FORECAST_NUM_OF_ROWS = 2000;
const PUBLICATION_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

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

const providerItemSchema = z
  .object({
    baseDate: z.string().regex(/^\d{8}$/),
    baseTime: z.string().regex(/^\d{4}$/),
    category: z.string().min(1),
    fcstDate: z.string().regex(/^\d{8}$/),
    fcstTime: z.string().regex(/^\d{4}$/),
    fcstValue: z.union([z.string(), z.number().finite()]),
    nx: z.number().int(),
    ny: z.number().int(),
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

const providerSuccessSchema = z
  .object({
    response: z
      .object({
        header: providerHeaderSchema,
        body: z
          .object({
            dataType: z.literal('JSON'),
            items: providerItemsSchema,
            numOfRows: z.number().int().positive(),
            pageNo: z.number().int().positive(),
            totalCount: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const slotSchema = z
  .object({
    baseDate: z.string().regex(/^\d{8}$/),
    baseTime: z.enum(['0200', '0500', '0800', '1100', '1400', '1700', '2000', '2300']),
  })
  .strict();

const knownCategories = new Set([
  'PCP',
  'POP',
  'PTY',
  'REH',
  'SKY',
  'SNO',
  'TMN',
  'TMP',
  'TMX',
  'UUU',
  'VEC',
  'VVV',
  'WAV',
  'WSD',
]);
const supportedCategories = new Set(['PCP', 'POP', 'PTY', 'REH', 'SKY', 'TMP', 'WSD']);

const skyConditions = {
  1: 'clear',
  3: 'mostly-cloudy',
  4: 'overcast',
} as const;

const precipitationTypes = {
  0: 'none',
  1: 'rain',
  2: 'rain-snow',
  3: 'snow',
  4: 'shower',
} as const;

export const KMA_SHORT_TERM_FORECAST_REGIONS = WEATHER_REGIONS;

export type KmaShortTermForecastRegionId = keyof typeof KMA_SHORT_TERM_FORECAST_REGIONS;
export type KmaShortTermForecastRegion = (typeof KMA_SHORT_TERM_FORECAST_REGIONS)[KmaShortTermForecastRegionId];
export type KmaShortTermForecastSlot = Readonly<{ baseDate: string; baseTime: string }>;

export type FetchKmaShortTermForecastOptions = Readonly<{
  fetcher: typeof fetch;
  region: KmaShortTermForecastRegion;
  serviceKey: string;
  signal: AbortSignal;
  slot: KmaShortTermForecastSlot;
}>;

class KmaShortTermForecastProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KmaShortTermForecastProviderError';
  }
}

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('KMA forecast clock must return a non-negative safe epoch millisecond value');
  }
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const formatDate = (date: Date): string =>
  `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;

export function resolveKmaShortTermForecastSlot(epochMs: number): KmaShortTermForecastSlot {
  assertClock(epochMs);
  const publicationSafeKst = new Date(epochMs - PUBLICATION_SAFETY_LAG_MS + KST_OFFSET_MS);
  if (Number.isNaN(publicationSafeKst.getTime())) {
    throw new RangeError('KMA forecast clock is outside the supported date range');
  }

  const safeHour = publicationSafeKst.getUTCHours();
  const publicationHour = [...PUBLICATION_HOURS].reverse().find((hour) => hour <= safeHour);
  if (publicationHour !== undefined) {
    return Object.freeze({
      baseDate: formatDate(publicationSafeKst),
      baseTime: `${pad2(publicationHour)}00`,
    });
  }

  const previousDate = new Date(
    Date.UTC(
      publicationSafeKst.getUTCFullYear(),
      publicationSafeKst.getUTCMonth(),
      publicationSafeKst.getUTCDate() - 1,
    ),
  );
  return Object.freeze({
    baseDate: formatDate(previousDate),
    baseTime: '2300',
  });
}

const parseProviderResponse = (input: unknown) => {
  let header: z.infer<typeof providerHeaderSchema>;
  try {
    header = providerEnvelopeHeaderSchema.parse(input).response.header;
  } catch (error) {
    throw new KmaShortTermForecastProviderError('KMA forecast response header is invalid', error);
  }

  if (header.resultCode !== '00') {
    throw new KmaShortTermForecastProviderError('KMA forecast provider returned a non-success result');
  }

  try {
    return providerSuccessSchema.parse(input);
  } catch (error) {
    throw new KmaShortTermForecastProviderError('KMA forecast response body is invalid', error);
  }
};

const parseKstTimestamp = (date: string, time: string, label: string): number => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  if (
    !/^\d{8}$/.test(date) ||
    !/^\d{4}$/.test(time) ||
    year < 2000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute !== 0
  ) {
    throw new KmaShortTermForecastProviderError(`KMA ${label} timestamp is invalid`);
  }

  const utcCalendarValue = Date.UTC(year, month - 1, day, hour, minute);
  const calendar = new Date(utcCalendarValue);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute
  ) {
    throw new KmaShortTermForecastProviderError(`KMA ${label} timestamp is invalid`);
  }

  return utcCalendarValue - KST_OFFSET_MS;
};

const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

const parseFiniteNumber = (rawValue: string | number, category: string): number => {
  const serialized = typeof rawValue === 'number' ? String(rawValue) : rawValue.trim();
  if (!numericPattern.test(serialized)) {
    throw new KmaShortTermForecastProviderError(`KMA ${category} forecast value is invalid`);
  }
  const value = Number(serialized);
  if (!Number.isFinite(value)) {
    throw new KmaShortTermForecastProviderError(`KMA ${category} forecast value is invalid`);
  }
  return value;
};

const parseBoundedNumber = (
  rawValue: string | number,
  category: string,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): number => {
  const value = parseFiniteNumber(rawValue, category);
  if (value < minimum || value > maximum) {
    throw new KmaShortTermForecastProviderError(`KMA ${category} forecast value is outside its supported range`);
  }
  return value;
};

const parseCode = <Value>(
  rawValue: string | number,
  category: string,
  values: Readonly<Record<number, Value>>,
): Value => {
  const code = parseFiniteNumber(rawValue, category);
  if (!Number.isInteger(code) || !(code in values)) {
    throw new KmaShortTermForecastProviderError(`KMA ${category} forecast code is outside its supported range`);
  }
  return values[code] as Value;
};

const parsePrecipitationAmount = (rawValue: string | number) => {
  if (typeof rawValue !== 'string') {
    throw new KmaShortTermForecastProviderError('KMA PCP forecast value is invalid');
  }
  const value = rawValue.trim().replace(/\s+/g, ' ');
  if (value === '강수없음' || value === '강수 없음') {
    return { kind: 'none' as const };
  }

  const lessThan = /^(\d+(?:\.\d+)?)mm 미만$/.exec(value);
  if (lessThan !== null) {
    const millimeters = Number(lessThan[1]);
    if (Number.isFinite(millimeters) && millimeters > 0) {
      return { kind: 'less-than' as const, millimeters };
    }
  }

  const range = /^(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)mm$/.exec(value);
  if (range !== null) {
    const minimumMillimeters = Number(range[1]);
    const maximumMillimeters = Number(range[2]);
    if (
      Number.isFinite(minimumMillimeters) &&
      Number.isFinite(maximumMillimeters) &&
      minimumMillimeters >= 0 &&
      maximumMillimeters > minimumMillimeters
    ) {
      return { kind: 'range' as const, maximumMillimeters, minimumMillimeters };
    }
  }

  const atLeast = /^(\d+(?:\.\d+)?)mm 이상$/.exec(value);
  if (atLeast !== null) {
    const millimeters = Number(atLeast[1]);
    if (Number.isFinite(millimeters) && millimeters >= 0) {
      return { kind: 'at-least' as const, millimeters };
    }
  }

  const amount = /^(\d+(?:\.\d+)?)mm$/.exec(value);
  if (amount !== null) {
    const millimeters = Number(amount[1]);
    if (Number.isFinite(millimeters) && millimeters >= 0) {
      return { kind: 'amount' as const, millimeters };
    }
  }

  throw new KmaShortTermForecastProviderError('KMA PCP forecast value is invalid');
};

const normalizePeriod = (forecastAt: number, measurements: ReadonlyMap<string, string | number>) => {
  const readOptional = <Value>(category: string, parser: (rawValue: string | number) => Value): Value | null => {
    const rawValue = measurements.get(category);
    return rawValue === undefined ? null : parser(rawValue);
  };

  return {
    availability: 'available' as const,
    forecastAt,
    precipitationAmount: readOptional('PCP', parsePrecipitationAmount),
    precipitationProbabilityPercent: readOptional('POP', (value) => parseBoundedNumber(value, 'POP', 0, 100)),
    precipitationType: readOptional('PTY', (value) => parseCode(value, 'PTY', precipitationTypes)),
    relativeHumidityPercent: readOptional('REH', (value) => parseBoundedNumber(value, 'REH', 0, 100)),
    skyCondition: readOptional('SKY', (value) => parseCode(value, 'SKY', skyConditions)),
    temperatureCelsius: readOptional('TMP', (value) => parseFiniteNumber(value, 'TMP')),
    windSpeedMetersPerSecond: readOptional('WSD', (value) => parseBoundedNumber(value, 'WSD', 0)),
  };
};

export function normalizeKmaShortTermForecast(
  input: unknown,
  regionId: KmaShortTermForecastRegionId,
  expectedSlot: KmaShortTermForecastSlot,
  collectionTime: number,
) {
  const region = KMA_SHORT_TERM_FORECAST_REGIONS[regionId];
  if (region === undefined) {
    throw new KmaShortTermForecastProviderError('KMA forecast region is invalid');
  }

  let requestedSlot: z.infer<typeof slotSchema>;
  try {
    requestedSlot = slotSchema.parse(expectedSlot);
  } catch (error) {
    throw new KmaShortTermForecastProviderError('Requested KMA forecast slot is invalid', error);
  }

  const parsed = parseProviderResponse(input);
  const { numOfRows, pageNo, totalCount } = parsed.response.body;
  const items = parsed.response.body.items === '' ? [] : parsed.response.body.items.item;
  if (
    pageNo !== KMA_FORECAST_PAGE_NO ||
    numOfRows !== KMA_FORECAST_NUM_OF_ROWS ||
    totalCount > KMA_FORECAST_NUM_OF_ROWS ||
    items.length !== totalCount
  ) {
    throw new KmaShortTermForecastProviderError('KMA forecast pagination metadata does not match the returned items');
  }
  if (items.length === 0) {
    return null;
  }

  const measurementsByForecastAt = new Map<number, Map<string, string | number>>();
  for (const item of items) {
    if (item.nx !== region.nx || item.ny !== region.ny) {
      throw new KmaShortTermForecastProviderError('KMA forecast grid does not match the selected region');
    }
    if (item.baseDate !== requestedSlot.baseDate || item.baseTime !== requestedSlot.baseTime) {
      throw new KmaShortTermForecastProviderError(
        'KMA forecast publication timestamp does not match the requested slot',
      );
    }
    if (!knownCategories.has(item.category)) {
      throw new KmaShortTermForecastProviderError('KMA forecast response contains an unknown category');
    }

    const forecastAt = parseKstTimestamp(item.fcstDate, item.fcstTime, 'forecast');
    const measurements = measurementsByForecastAt.get(forecastAt) ?? new Map<string, string | number>();
    if (measurements.has(item.category)) {
      throw new KmaShortTermForecastProviderError('KMA forecast response contains a duplicate category');
    }
    measurements.set(item.category, item.fcstValue);
    measurementsByForecastAt.set(forecastAt, measurements);
  }

  const supportedForecastTimes = [...measurementsByForecastAt]
    .filter(([, measurements]) => [...measurements.keys()].some((category) => supportedCategories.has(category)))
    .map(([forecastAt]) => forecastAt)
    .sort((left, right) => left - right);
  assertClock(collectionTime);
  const firstForecastAt = Math.ceil(collectionTime / HOUR_MS) * HOUR_MS;
  const forecastWindowEnd = firstForecastAt + 24 * HOUR_MS;
  if (
    supportedForecastTimes.length === 0 ||
    !supportedForecastTimes.some((forecastAt) => forecastAt >= firstForecastAt && forecastAt < forecastWindowEnd)
  ) {
    return null;
  }

  const periods = Array.from({ length: 24 }, (_, index) => {
    const forecastAt = firstForecastAt + index * HOUR_MS;
    const allMeasurements = measurementsByForecastAt.get(forecastAt);
    if (allMeasurements === undefined) {
      return { availability: 'unavailable' as const, forecastAt };
    }
    const supportedMeasurements = new Map(
      [...allMeasurements].filter(([category]) => supportedCategories.has(category)),
    );
    return supportedMeasurements.size === 0
      ? { availability: 'unavailable' as const, forecastAt }
      : normalizePeriod(forecastAt, supportedMeasurements);
  });

  const normalized = {
    issuedAt: parseKstTimestamp(requestedSlot.baseDate, requestedSlot.baseTime, 'publication'),
    periods,
    region: regionId,
  };

  try {
    return weatherForecastDataSchema.parse(normalized);
  } catch (error) {
    throw new KmaShortTermForecastProviderError('Normalized KMA forecast data is invalid', error);
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const normalizeServiceKey = (input: string): string => {
  if (!/%[0-9a-f]{2}/i.test(input)) {
    return input;
  }
  try {
    return decodeURIComponent(input);
  } catch {
    throw new KmaShortTermForecastProviderError('KMA service key encoding is invalid');
  }
};

export async function fetchKmaShortTermForecast(options: FetchKmaShortTermForecastOptions): Promise<unknown> {
  const serviceKey = normalizeServiceKey(options.serviceKey.trim());
  if (serviceKey.length === 0) {
    throw new TypeError('KMA service key must not be empty');
  }
  const slot = slotSchema.parse(options.slot);
  const url = new URL(KMA_SHORT_TERM_FORECAST_ENDPOINT);
  url.searchParams.set('ServiceKey', serviceKey);
  url.searchParams.set('pageNo', String(KMA_FORECAST_PAGE_NO));
  url.searchParams.set('numOfRows', String(KMA_FORECAST_NUM_OF_ROWS));
  url.searchParams.set('dataType', 'JSON');
  url.searchParams.set('base_date', slot.baseDate);
  url.searchParams.set('base_time', slot.baseTime);
  url.searchParams.set('nx', String(options.region.nx));
  url.searchParams.set('ny', String(options.region.ny));

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
    throw new KmaShortTermForecastProviderError('KMA forecast request failed', error);
  }

  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }
  if (!response.ok) {
    throw new KmaShortTermForecastProviderError('KMA forecast request returned a non-success status');
  }

  try {
    return await response.json();
  } catch (error) {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new KmaShortTermForecastProviderError('KMA forecast response was not valid JSON', error);
  }
}
