import { z } from 'zod';

import { WEATHER_REGIONS, weatherNowcastDataSchema } from '../../../entities/weather/contract';

const KST_OFFSET_MS = 9 * 60 * 60_000;
const PUBLICATION_SAFETY_LAG_MS = 20 * 60_000;
const KMA_NOWCAST_ENDPOINT = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';

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
    nx: z.number().int(),
    ny: z.number().int(),
    obsrValue: z.union([z.string(), z.number().finite()]),
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
            pageNo: z.number().int().positive(),
            numOfRows: z.number().int().positive(),
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
    baseTime: z.string().regex(/^\d{2}00$/),
  })
  .strict();

const precipitationTypes = {
  0: 'none',
  1: 'rain',
  2: 'rain-snow',
  3: 'snow',
  5: 'raindrop',
  6: 'raindrop-snow-flurry',
  7: 'snow-flurry',
} as const;

export const KMA_WEATHER_REGIONS = WEATHER_REGIONS;

export type KmaWeatherRegionId = keyof typeof KMA_WEATHER_REGIONS;
export type KmaWeatherRegion = (typeof KMA_WEATHER_REGIONS)[KmaWeatherRegionId];
export type KmaNowcastSlot = Readonly<{ baseDate: string; baseTime: string }>;

export type FetchKmaUltraShortNowcastOptions = Readonly<{
  fetcher: typeof fetch;
  region: KmaWeatherRegion;
  serviceKey: string;
  signal: AbortSignal;
  slot: KmaNowcastSlot;
}>;

class KmaProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KmaProviderError';
  }
}

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('KMA clock must return a non-negative safe epoch millisecond value');
  }
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

export function resolveKmaNowcastSlot(epochMs: number): KmaNowcastSlot {
  assertClock(epochMs);
  const publicationSafeKst = new Date(epochMs - PUBLICATION_SAFETY_LAG_MS + KST_OFFSET_MS);

  if (Number.isNaN(publicationSafeKst.getTime())) {
    throw new RangeError('KMA clock is outside the supported date range');
  }

  return Object.freeze({
    baseDate: `${publicationSafeKst.getUTCFullYear()}${pad2(publicationSafeKst.getUTCMonth() + 1)}${pad2(
      publicationSafeKst.getUTCDate(),
    )}`,
    baseTime: `${pad2(publicationSafeKst.getUTCHours())}00`,
  });
}

const parseProviderResponse = (input: unknown) => {
  let header: z.infer<typeof providerHeaderSchema>;

  try {
    header = providerEnvelopeHeaderSchema.parse(input).response.header;
  } catch (error) {
    throw new KmaProviderError('KMA response header is invalid', error);
  }

  if (header.resultCode !== '00') {
    throw new KmaProviderError('KMA provider returned a non-success result');
  }

  try {
    return providerSuccessSchema.parse(input);
  } catch (error) {
    throw new KmaProviderError('KMA response body is invalid', error);
  }
};

const parseObservedAt = (baseDate: string, baseTime: string): number => {
  const year = Number(baseDate.slice(0, 4));
  const month = Number(baseDate.slice(4, 6));
  const day = Number(baseDate.slice(6, 8));
  const hour = Number(baseTime.slice(0, 2));
  const minute = Number(baseTime.slice(2, 4));

  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute !== 0) {
    throw new KmaProviderError('KMA observation timestamp is invalid');
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
    throw new KmaProviderError('KMA observation timestamp is invalid');
  }

  return utcCalendarValue - KST_OFFSET_MS;
};

const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

const parseFiniteMeasurement = (rawValue: string | number, category: string): number => {
  const serialized = typeof rawValue === 'number' ? String(rawValue) : rawValue.trim();
  if (!numericPattern.test(serialized)) {
    throw new KmaProviderError(`KMA ${category} measurement is invalid`);
  }

  const value = Number(serialized);
  if (!Number.isFinite(value)) {
    throw new KmaProviderError(`KMA ${category} measurement is invalid`);
  }

  return value;
};

const parseBoundedMeasurement = (
  rawValue: string | number,
  category: string,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): number => {
  const value = parseFiniteMeasurement(rawValue, category);
  if (value < minimum || value > maximum) {
    throw new KmaProviderError(`KMA ${category} measurement is outside its supported range`);
  }

  return value;
};

const parsePrecipitationType = (rawValue: string | number) => {
  const value = parseFiniteMeasurement(rawValue, 'PTY');
  if (!Number.isInteger(value) || !(value in precipitationTypes)) {
    throw new KmaProviderError('KMA PTY measurement is outside its supported range');
  }

  return precipitationTypes[value as keyof typeof precipitationTypes];
};

export function normalizeKmaUltraShortNowcast(
  input: unknown,
  regionId: KmaWeatherRegionId,
  expectedSlot: KmaNowcastSlot,
) {
  const region = KMA_WEATHER_REGIONS[regionId];
  if (region === undefined) {
    throw new KmaProviderError('KMA weather region is invalid');
  }

  const parsed = parseProviderResponse(input);
  let requestedSlot: KmaNowcastSlot;
  try {
    requestedSlot = slotSchema.parse(expectedSlot);
  } catch (error) {
    throw new KmaProviderError('Requested KMA observation slot is invalid', error);
  }
  const items = parsed.response.body.items === '' ? [] : parsed.response.body.items.item;
  if (items.length === 0) {
    return null;
  }

  const firstItem = items[0];
  if (firstItem === undefined) {
    return null;
  }

  for (const item of items) {
    if (item.nx !== region.nx || item.ny !== region.ny) {
      throw new KmaProviderError('KMA observation grid does not match the selected region');
    }

    if (item.baseDate !== firstItem.baseDate || item.baseTime !== firstItem.baseTime) {
      throw new KmaProviderError('KMA observation categories do not share one timestamp');
    }
  }

  if (firstItem.baseDate !== requestedSlot.baseDate || firstItem.baseTime !== requestedSlot.baseTime) {
    throw new KmaProviderError('KMA observation timestamp does not match the requested slot');
  }

  const observedAt = parseObservedAt(firstItem.baseDate, firstItem.baseTime);
  const measurements = new Map<string, string | number>();
  for (const item of items) {
    if (measurements.has(item.category)) {
      throw new KmaProviderError('KMA response contains a duplicate category');
    }
    measurements.set(item.category, item.obsrValue);
  }

  const supportedCategories = ['T1H', 'REH', 'RN1', 'PTY', 'WSD', 'VEC'] as const;
  if (!supportedCategories.some((category) => measurements.has(category))) {
    return null;
  }

  const readOptional = <Value>(category: string, parser: (rawValue: string | number) => Value): Value | null => {
    const rawValue = measurements.get(category);
    return rawValue === undefined ? null : parser(rawValue);
  };

  const normalized = {
    region: regionId,
    observedAt,
    temperatureCelsius: readOptional('T1H', (value) => parseFiniteMeasurement(value, 'T1H')),
    relativeHumidityPercent: readOptional('REH', (value) => parseBoundedMeasurement(value, 'REH', 0, 100)),
    precipitationLastHourMm: readOptional('RN1', (value) => parseBoundedMeasurement(value, 'RN1', 0)),
    precipitationType: readOptional('PTY', parsePrecipitationType),
    windSpeedMetersPerSecond: readOptional('WSD', (value) => parseBoundedMeasurement(value, 'WSD', 0)),
    windDirectionDegrees: readOptional('VEC', (value) => parseBoundedMeasurement(value, 'VEC', 0, 360)),
  };

  try {
    return weatherNowcastDataSchema.parse(normalized);
  } catch (error) {
    throw new KmaProviderError('Normalized KMA weather data is invalid', error);
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

export async function fetchKmaUltraShortNowcast(options: FetchKmaUltraShortNowcastOptions): Promise<unknown> {
  const serviceKey = options.serviceKey.trim();
  if (serviceKey.length === 0) {
    throw new TypeError('KMA service key must not be empty');
  }

  const slot = slotSchema.parse(options.slot);
  const url = new URL(KMA_NOWCAST_ENDPOINT);
  url.searchParams.set('ServiceKey', serviceKey);
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', '1000');
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
    throw new KmaProviderError('KMA request failed', error);
  }

  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }
  if (!response.ok) {
    throw new KmaProviderError('KMA request returned a non-success status');
  }

  try {
    return await response.json();
  } catch (error) {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new KmaProviderError('KMA response was not valid JSON', error);
  }
}

export function readKmaWeatherCredential(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const credential = environment.DATA_GO_KR_SERVICE_KEY?.trim() ?? '';
  return credential.length === 0 ? undefined : credential;
}
