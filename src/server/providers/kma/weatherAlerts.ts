import { z } from 'zod';

import {
  WEATHER_ALERT_COMMAND_BY_CODE,
  WEATHER_ALERT_KIND_BY_CODE,
  WEATHER_ALERT_LEVEL_BY_CODE,
  type WeatherAlert,
  type WeatherAlertBulletin,
  type WeatherAlertData,
  weatherAlertDataSchema,
} from '../../../entities/weather-alert/contract';

const KST_OFFSET_MS = 9 * 60 * 60_000;
const KMA_WEATHER_ALERT_BASE_URL = 'https://apis.data.go.kr/1360000/WthrWrnInfoService/';
const STATUS_PAGE_SIZE = 10;
const CODE_PAGE_SIZE = 1000;
const BULLETIN_PAGE_SIZE = 100;
const NATIONAL_STATION_ID = 108;

const integerValueSchema = z
  .union([z.number().int(), z.string().regex(/^-?\d+$/u)])
  .transform((value) => Number(value));
const timestampValueSchema = z
  .union([z.string(), z.number().int()])
  .transform((value) => String(value))
  .pipe(z.string().regex(/^\d{12}$/u));
const optionalTimestampValueSchema = z.union([timestampValueSchema, z.literal(''), z.null(), z.undefined()]);

const providerHeaderSchema = z
  .object({
    resultCode: z.union([z.string(), z.number()]),
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

const statusItemSchema = z
  .object({
    other: z.string(),
    t6: z.string().min(1),
    t7: z.string(),
    tmEf: timestampValueSchema,
    tmFc: timestampValueSchema,
    tmSeq: integerValueSchema,
  })
  .strict();

const codeItemSchema = z
  .object({
    allEndTime: optionalTimestampValueSchema.optional(),
    areaCode: z.string().min(1),
    areaName: z.string().min(1),
    cancel: integerValueSchema,
    command: integerValueSchema,
    endTime: optionalTimestampValueSchema.optional(),
    startTime: optionalTimestampValueSchema.optional(),
    stnId: integerValueSchema,
    tmFc: timestampValueSchema,
    tmSeq: integerValueSchema,
    warnStress: integerValueSchema,
    warnVar: integerValueSchema,
  })
  .strict();

const bulletinItemSchema = z
  .object({
    other: z.string(),
    stnId: integerValueSchema,
    t1: z.string().min(1),
    t2: z.string(),
    t3: z.string(),
    t4: z.string(),
    t5: timestampValueSchema,
    t6: z.string(),
    t7: z.string(),
    tmFc: timestampValueSchema,
    tmSeq: integerValueSchema,
    warFc: integerValueSchema,
  })
  .strict();

const createItemsSchema = <Item extends z.ZodType>(itemSchema: Item) =>
  z.union([
    z
      .object({
        item: z.union([z.array(itemSchema), itemSchema]),
      })
      .strict(),
    z.literal(''),
  ]);

const createSuccessSchema = <Item extends z.ZodType>(itemSchema: Item) =>
  z
    .object({
      response: z
        .object({
          body: z
            .object({
              dataType: z.literal('JSON'),
              items: createItemsSchema(itemSchema),
              numOfRows: integerValueSchema,
              pageNo: integerValueSchema,
              totalCount: integerValueSchema,
            })
            .strict(),
          header: providerHeaderSchema,
        })
        .strict(),
    })
    .strict();

const statusSuccessSchema = createSuccessSchema(statusItemSchema);
const codeSuccessSchema = createSuccessSchema(codeItemSchema);
const bulletinSuccessSchema = createSuccessSchema(bulletinItemSchema);

type StatusItem = z.infer<typeof statusItemSchema>;
type CodeItem = z.infer<typeof codeItemSchema>;

export type KmaWeatherAlertResponses = Readonly<{
  bulletin: unknown | null;
  bulletinAvailable: boolean;
  codes: unknown | null;
  status: unknown;
}>;

export type FetchKmaWeatherAlertsOptions = Readonly<{
  clock: () => number;
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}>;

class KmaWeatherAlertProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KmaWeatherAlertProviderError';
  }
}

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('KMA weather alert clock must return a non-negative safe epoch millisecond value');
  }
};

const parseProviderHeader = (input: unknown, label: string): void => {
  let header: z.infer<typeof providerHeaderSchema>;
  try {
    header = providerEnvelopeHeaderSchema.parse(input).response.header;
  } catch (error) {
    throw new KmaWeatherAlertProviderError(`KMA weather alert ${label} response header is invalid`, error);
  }
  if (!['0', '00'].includes(String(header.resultCode))) {
    throw new KmaWeatherAlertProviderError(`KMA weather alert ${label} provider rejected the request`);
  }
};

const readItems = <Item>(
  input: unknown,
  schema: z.ZodType<{
    response: {
      body: {
        dataType: 'JSON';
        items: '' | { item: Item | Item[] };
        numOfRows: number;
        pageNo: number;
        totalCount: number;
      };
      header: { resultCode: string | number; resultMsg: string };
    };
  }>,
  expectedPageSize: number,
  label: string,
): Item[] => {
  parseProviderHeader(input, label);
  let parsed: z.infer<typeof schema>;
  try {
    parsed = schema.parse(input);
  } catch (error) {
    throw new KmaWeatherAlertProviderError(`KMA weather alert ${label} response body is invalid`, error);
  }

  const { items, numOfRows, pageNo, totalCount } = parsed.response.body;
  const normalizedItems = items === '' ? [] : Array.isArray(items.item) ? items.item : [items.item];
  if (
    pageNo !== 1 ||
    numOfRows !== expectedPageSize ||
    totalCount < 0 ||
    totalCount > expectedPageSize ||
    normalizedItems.length !== totalCount
  ) {
    throw new KmaWeatherAlertProviderError(
      `KMA weather alert ${label} pagination metadata does not match the returned items`,
    );
  }
  return normalizedItems;
};

const parseKstTimestamp = (input: string, label: string): number => {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/u.exec(input);
  if (match === null) {
    throw new KmaWeatherAlertProviderError(`KMA weather alert ${label} timestamp is invalid`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const epochMs = Date.UTC(year, month - 1, day, hour - 9, minute);
  const roundTrip = new Date(epochMs + KST_OFFSET_MS);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() + 1 !== month ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute
  ) {
    throw new KmaWeatherAlertProviderError(`KMA weather alert ${label} timestamp is outside the calendar`);
  }
  return epochMs;
};

const normalizeOptionalTimestamp = (input: string | null | undefined): string | null =>
  input === undefined || input === null || input === '' ? null : input;

const noActiveStatusPattern = /^(?:o|○)?없음\.?$/iu;

const parseCurrentStatus = (
  input: unknown,
): Readonly<{ effectiveAt: number; issuedAt: number; item: StatusItem }> | null => {
  const items = readItems(input, statusSuccessSchema, STATUS_PAGE_SIZE, 'status');
  if (items.length === 0) {
    return null;
  }
  if (items.length !== 1) {
    throw new KmaWeatherAlertProviderError('KMA weather alert status must contain exactly one current snapshot');
  }
  const item = items[0];
  if (item === undefined) {
    return null;
  }
  if (noActiveStatusPattern.test(item.t6.replace(/\s+/gu, ''))) {
    return null;
  }
  return Object.freeze({
    effectiveAt: parseKstTimestamp(item.tmEf, 'status effective'),
    issuedAt: parseKstTimestamp(item.tmFc, 'status issue'),
    item,
  });
};

const activeCommandCodes = new Set([1, 3, 6, 7]);
const releaseCommandCodes = new Set([2, 8]);
const levelPriority: Record<WeatherAlert['level'], number> = {
  'emergency-warning': 0,
  warning: 1,
  advisory: 2,
  unknown: 3,
};

const normalizeStructuredAlerts = (input: unknown): WeatherAlert[] => {
  const items = readItems(input, codeSuccessSchema, CODE_PAGE_SIZE, 'codes');
  const lifecycle = new Map<string, CodeItem>();
  const uniqueEvents = new Map<string, CodeItem>();
  for (const item of items) {
    const identity = `${item.tmFc}:${item.tmSeq}:${item.areaCode}:${item.warnVar}`;
    const existing = uniqueEvents.get(identity);
    if (existing === undefined) {
      uniqueEvents.set(identity, item);
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(item)) {
      throw new KmaWeatherAlertProviderError('KMA weather alert event identity has conflicting rows');
    }
  }

  const ordered = [...uniqueEvents.values()].sort((left, right) => {
    const timestampOrder = left.tmFc.localeCompare(right.tmFc);
    if (timestampOrder !== 0) {
      return timestampOrder;
    }
    if (left.tmSeq !== right.tmSeq) {
      return left.tmSeq - right.tmSeq;
    }
    const areaOrder = left.areaCode.localeCompare(right.areaCode);
    return areaOrder === 0 ? left.warnVar - right.warnVar : areaOrder;
  });

  for (const item of ordered) {
    if (![0, 1].includes(item.cancel)) {
      throw new KmaWeatherAlertProviderError('KMA weather alert cancellation code is undocumented');
    }
    if (item.cancel === 1) {
      continue;
    }
    const key = `${item.areaCode}:${item.warnVar}`;
    if (releaseCommandCodes.has(item.command)) {
      lifecycle.delete(key);
      continue;
    }
    if (!activeCommandCodes.has(item.command)) {
      throw new KmaWeatherAlertProviderError('KMA weather alert lifecycle command is undocumented');
    }
    if (normalizeOptionalTimestamp(item.startTime) === null) {
      throw new KmaWeatherAlertProviderError('KMA weather alert active lifecycle row has no effective time');
    }
    lifecycle.set(key, item);
  }

  const alerts = [...lifecycle.values()].map((item): WeatherAlert => {
    const effectiveTime = normalizeOptionalTimestamp(item.startTime);
    if (effectiveTime === null) {
      throw new KmaWeatherAlertProviderError('KMA weather alert effective time is missing');
    }
    const kind =
      WEATHER_ALERT_KIND_BY_CODE[item.warnVar as keyof typeof WEATHER_ALERT_KIND_BY_CODE] ?? ('unknown' as const);
    const level =
      WEATHER_ALERT_LEVEL_BY_CODE[item.warnStress as keyof typeof WEATHER_ALERT_LEVEL_BY_CODE] ?? ('unknown' as const);
    const command = WEATHER_ALERT_COMMAND_BY_CODE[item.command as keyof typeof WEATHER_ALERT_COMMAND_BY_CODE];
    if (command === undefined) {
      throw new KmaWeatherAlertProviderError('KMA weather alert active command cannot be normalized');
    }
    const endingTime = normalizeOptionalTimestamp(item.endTime) ?? normalizeOptionalTimestamp(item.allEndTime);
    return {
      areaCode: item.areaCode.trim(),
      areaName: item.areaName.trim(),
      command,
      commandCode: item.command,
      effectiveAt: parseKstTimestamp(effectiveTime, 'effective'),
      endsAt: endingTime === null ? null : parseKstTimestamp(endingTime, 'end'),
      id: `${item.tmFc}-${item.tmSeq}-${item.areaCode.trim()}-${item.warnVar}`,
      issuedAt: parseKstTimestamp(item.tmFc, 'issue'),
      kind,
      kindCode: item.warnVar,
      level,
      levelCode: item.warnStress,
    };
  });

  return alerts.sort((left, right) => {
    const levelOrder = levelPriority[left.level] - levelPriority[right.level];
    if (levelOrder !== 0) {
      return levelOrder;
    }
    if (left.effectiveAt !== right.effectiveAt) {
      return right.effectiveAt - left.effectiveAt;
    }
    return left.id.localeCompare(right.id);
  });
};

const unavailableBulletin = Object.freeze({ availability: 'unavailable' as const });

const normalizeBulletin = (input: unknown | null, available: boolean, status: StatusItem): WeatherAlertBulletin => {
  if (!available || input === null) {
    return unavailableBulletin;
  }
  try {
    const items = readItems(input, bulletinSuccessSchema, BULLETIN_PAGE_SIZE, 'bulletin');
    const matching = items.filter((item) => item.tmFc === status.tmFc && item.tmSeq === status.tmSeq);
    const current = matching[0];
    if (current === undefined || matching.some((item) => JSON.stringify(item) !== JSON.stringify(current))) {
      return unavailableBulletin;
    }
    const details = current.t4.trim();
    return {
      availability: 'available',
      details: details.length === 0 ? null : details,
      issuedAt: parseKstTimestamp(current.tmFc, 'bulletin issue'),
      title: current.t1.trim(),
    };
  } catch {
    return unavailableBulletin;
  }
};

export function normalizeKmaWeatherAlerts(input: KmaWeatherAlertResponses, collectionTime: number): WeatherAlertData {
  assertClock(collectionTime);
  const status = parseCurrentStatus(input.status);
  if (status === null) {
    return null;
  }
  if (input.codes === null) {
    throw new KmaWeatherAlertProviderError('KMA weather alert status is active but lifecycle data is missing');
  }

  const alerts = normalizeStructuredAlerts(input.codes);
  if (alerts.length === 0) {
    throw new KmaWeatherAlertProviderError(
      'KMA weather alert status is active but structured lifecycle has no active rows',
    );
  }
  try {
    return weatherAlertDataSchema.parse({
      alerts,
      bulletin: normalizeBulletin(input.bulletin, input.bulletinAvailable, status.item),
      statusEffectiveAt: status.effectiveAt,
      statusIssuedAt: status.issuedAt,
    });
  } catch (error) {
    throw new KmaWeatherAlertProviderError('Normalized KMA weather alert data is invalid', error);
  }
}

const normalizeServiceKey = (input: string): string => {
  const trimmed = input.trim();
  if (!/%[0-9a-f]{2}/iu.test(trimmed)) {
    return trimmed;
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    throw new KmaWeatherAlertProviderError('KMA weather alert service key encoding is invalid');
  }
};

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const fetchProviderJson = async (
  options: FetchKmaWeatherAlertsOptions,
  path: 'getPwnStatus' | 'getPwnCd' | 'getWthrWrnMsg',
  parameters: Readonly<Record<string, string>>,
): Promise<unknown> => {
  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }
  const serviceKey = normalizeServiceKey(options.serviceKey);
  if (serviceKey.length === 0) {
    throw new TypeError('KMA weather alert service key must not be empty');
  }
  const url = new URL(path, KMA_WEATHER_ALERT_BASE_URL);
  url.searchParams.set('serviceKey', serviceKey);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await options.fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new KmaWeatherAlertProviderError('KMA weather alert request failed', error);
  }
  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }
  if (!response.ok) {
    throw new KmaWeatherAlertProviderError('KMA weather alert request returned a non-success status');
  }
  try {
    return await response.json();
  } catch (error) {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new KmaWeatherAlertProviderError('KMA weather alert response was not valid JSON', error);
  }
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const formatKstDate = (epochMs: number, dayOffset: number): string => {
  const kst = new Date(epochMs + KST_OFFSET_MS);
  const shifted = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + dayOffset));
  return `${shifted.getUTCFullYear()}${pad2(shifted.getUTCMonth() + 1)}${pad2(shifted.getUTCDate())}`;
};

export async function fetchKmaWeatherAlerts(options: FetchKmaWeatherAlertsOptions): Promise<WeatherAlertData> {
  const collectionTime = options.clock();
  assertClock(collectionTime);
  const status = await fetchProviderJson(options, 'getPwnStatus', {
    dataType: 'JSON',
    numOfRows: String(STATUS_PAGE_SIZE),
    pageNo: '1',
  });
  if (parseCurrentStatus(status) === null) {
    return null;
  }

  const codesPromise = fetchProviderJson(options, 'getPwnCd', {
    dataType: 'JSON',
    fromTmFc: formatKstDate(collectionTime, -5),
    numOfRows: String(CODE_PAGE_SIZE),
    pageNo: '1',
    toTmFc: formatKstDate(collectionTime, 0),
  });
  const bulletinPromise = fetchProviderJson(options, 'getWthrWrnMsg', {
    dataType: 'JSON',
    fromTmFc: formatKstDate(collectionTime, -1),
    numOfRows: String(BULLETIN_PAGE_SIZE),
    pageNo: '1',
    stnId: String(NATIONAL_STATION_ID),
    toTmFc: formatKstDate(collectionTime, 0),
  })
    .then((bulletin) => ({ available: true as const, bulletin }))
    .catch(() => {
      if (options.signal.aborted) {
        throwAbortReason(options.signal);
      }
      return { available: false as const, bulletin: null };
    });

  const [codes, bulletinResult] = await Promise.all([codesPromise, bulletinPromise]);
  return normalizeKmaWeatherAlerts(
    {
      bulletin: bulletinResult.bulletin,
      bulletinAvailable: bulletinResult.available,
      codes,
      status,
    },
    collectionTime,
  );
}
