import { z } from 'zod';

import type { MARKET_INDEXES, MarketIndex } from '../../../entities/market/contract';

const FSC_MARKET_INDEX_ENDPOINT =
  'https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex';
const FSC_PAGE_SIZE = 30;
const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

const providerValueSchema = z.union([z.string(), z.number().finite()]);
const providerTextSchema = z.string();

const providerRowSchema = z
  .object({
    basDt: providerTextSchema,
    idxCsf: providerTextSchema.optional(),
    idxNm: providerTextSchema,
    epyItmsCnt: providerValueSchema.optional(),
    clpr: providerValueSchema,
    vs: providerValueSchema,
    fltRt: providerValueSchema,
    mkp: providerValueSchema.optional(),
    hipr: providerValueSchema.optional(),
    lopr: providerValueSchema.optional(),
    trqu: providerValueSchema.optional(),
    trPrc: providerValueSchema.optional(),
    lstgMrktTotAmt: providerValueSchema.optional(),
    lsYrEdVsFltRg: providerValueSchema.optional(),
    lsYrEdVsFltRt: providerValueSchema.optional(),
    yrWRcrdHgst: providerValueSchema.optional(),
    yrWRcrdHgstDt: providerTextSchema.optional(),
    yrWRcrdLwst: providerValueSchema.optional(),
    yrWRcrdLwstDt: providerTextSchema.optional(),
    basPntm: providerTextSchema.optional(),
    basIdx: providerValueSchema.optional(),
  })
  .strict();

const providerItemsSchema = z
  .object({
    item: z.union([providerRowSchema, z.array(providerRowSchema)]),
  })
  .strict();

const providerHeaderSchema = z
  .object({
    resultCode: z.string(),
    resultMsg: z.string(),
  })
  .strict();

const providerBodySchema = z
  .object({
    items: providerItemsSchema,
    numOfRows: providerValueSchema,
    pageNo: providerValueSchema,
    totalCount: providerValueSchema,
  })
  .strict();

const providerPayloadSchema = z
  .object({
    body: providerBodySchema,
    header: providerHeaderSchema,
  })
  .strict();

const providerResponseSchema = z.union([
  providerPayloadSchema,
  z
    .object({
      response: providerPayloadSchema,
    })
    .strict(),
]);

type ProviderRow = z.infer<typeof providerRowSchema>;

export type FscMarketSearchWindow = Readonly<{
  from: string;
  toExclusive: string;
}>;

export type FetchFscMarketIndexOptions = Readonly<{
  definition: (typeof MARKET_INDEXES)[number];
  fetcher: typeof fetch;
  now: number;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class FscMarketProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FscMarketProviderError';
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const parseSafeInteger = (input: string | number, label: string): number => {
  const serialized = String(input).trim();
  if (!/^\d+$/.test(serialized)) {
    throw new FscMarketProviderError(`FSC ${label} is invalid`);
  }
  const value = Number(serialized);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FscMarketProviderError(`FSC ${label} is invalid`);
  }
  return value;
};

const parseFiniteNumber = (input: string | number, label: string): number => {
  const serialized = String(input).trim();
  if (!numericPattern.test(serialized)) {
    throw new FscMarketProviderError(`FSC ${label} is invalid`);
  }
  const value = Number(serialized);
  if (!Number.isFinite(value)) {
    throw new FscMarketProviderError(`FSC ${label} is invalid`);
  }
  return value;
};

const hasConsistentDirection = (change: number, changePercent: number): boolean =>
  !((change > 0 && changePercent < 0) || (change < 0 && changePercent > 0) || (change === 0 && changePercent !== 0));

const normalizeServiceKey = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new FscMarketProviderError('FSC market credential is missing');
  }
  if (!/%[0-9a-f]{2}/i.test(trimmed)) {
    return trimmed;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    throw new FscMarketProviderError('FSC market credential encoding is invalid');
  }
};

const assertCalendarDate = (date: string): void => {
  if (!/^\d{8}$/.test(date)) {
    throw new FscMarketProviderError('FSC market date is invalid');
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2020 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    throw new FscMarketProviderError('FSC market date is invalid');
  }
};

const normalizeAvailableIndex = (
  definition: (typeof MARKET_INDEXES)[number],
  rows: readonly ProviderRow[],
  window: FscMarketSearchWindow,
): MarketIndex => {
  const expectedClassification = definition.id === 'kospi' ? 'KOSPI시리즈' : 'KOSDAQ시리즈';
  const dates = new Set<string>();
  let latest:
    | Readonly<{
        change: number;
        changePercent: number;
        close: number;
        date: string;
      }>
    | undefined;

  for (const row of rows) {
    if (row.idxNm.trim() !== definition.providerName) {
      throw new FscMarketProviderError('FSC index name does not match the requested market');
    }
    if (row.idxCsf !== undefined && row.idxCsf.trim() !== expectedClassification) {
      throw new FscMarketProviderError('FSC index classification does not match the requested market');
    }

    const date = row.basDt.trim();
    assertCalendarDate(date);
    if (date < window.from || date >= window.toExclusive) {
      throw new FscMarketProviderError('FSC market date falls outside the requested search window');
    }
    if (dates.has(date)) {
      throw new FscMarketProviderError('FSC response contains an ambiguous duplicate date');
    }
    dates.add(date);

    const close = parseFiniteNumber(row.clpr, 'close');
    if (close <= 0) {
      throw new FscMarketProviderError('FSC close must be positive');
    }
    const change = parseFiniteNumber(row.vs, 'daily change');
    const changePercent = parseFiniteNumber(row.fltRt, 'daily change percent');
    if (!hasConsistentDirection(change, changePercent)) {
      throw new FscMarketProviderError('FSC daily change direction is inconsistent');
    }
    const observation = {
      change,
      changePercent,
      close,
      date,
    };
    if (latest === undefined || date > latest.date) {
      latest = observation;
    }
  }

  if (latest === undefined) {
    throw new FscMarketProviderError('FSC success response contains no market observations');
  }

  return {
    ...definition,
    observation: latest,
    status: 'available',
  };
};

export function normalizeFscMarketIndexResponse(
  input: unknown,
  definition: (typeof MARKET_INDEXES)[number],
  window: FscMarketSearchWindow,
): MarketIndex {
  let parsed: z.infer<typeof providerResponseSchema>;
  try {
    parsed = providerResponseSchema.parse(input);
  } catch (error) {
    throw new FscMarketProviderError('FSC market response is invalid', error);
  }

  const payload = 'response' in parsed ? parsed.response : parsed;
  if (payload.header.resultCode !== '00') {
    throw new FscMarketProviderError('FSC provider returned a non-success result');
  }

  const pageNo = parseSafeInteger(payload.body.pageNo, 'page number');
  const numOfRows = parseSafeInteger(payload.body.numOfRows, 'page size');
  const totalCount = parseSafeInteger(payload.body.totalCount, 'pagination total');
  const item = payload.body.items.item;
  const rows = Array.isArray(item) ? item : [item];

  if (pageNo !== 1 || numOfRows !== FSC_PAGE_SIZE || totalCount > FSC_PAGE_SIZE || totalCount !== rows.length) {
    throw new FscMarketProviderError('FSC pagination is invalid');
  }

  if (totalCount === 0) {
    return {
      ...definition,
      observation: null,
      status: 'empty',
    };
  }

  return normalizeAvailableIndex(definition, rows, window);
}

const formatDate = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
};

export const resolveFscMarketSearchWindow = (now: number): FscMarketSearchWindow => {
  if (!Number.isSafeInteger(now) || now < Date.UTC(2020, 0, 1)) {
    throw new FscMarketProviderError('FSC market search clock is invalid');
  }

  const kstCalendar = new Date(now + KST_OFFSET_MS);
  const currentDay = Date.UTC(kstCalendar.getUTCFullYear(), kstCalendar.getUTCMonth(), kstCalendar.getUTCDate());
  return {
    from: formatDate(currentDay - 21 * DAY_MS),
    toExclusive: formatDate(currentDay + DAY_MS),
  };
};

const createMarketIndexUrl = (
  serviceKey: string,
  definition: (typeof MARKET_INDEXES)[number],
  window: FscMarketSearchWindow,
): URL => {
  const url = new URL(FSC_MARKET_INDEX_ENDPOINT);
  url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  url.searchParams.set('resultType', 'json');
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', String(FSC_PAGE_SIZE));
  url.searchParams.set('idxNm', definition.providerName);
  url.searchParams.set('beginBasDt', window.from);
  url.searchParams.set('endBasDt', window.toExclusive);
  return url;
};

export async function fetchFscMarketIndex(options: FetchFscMarketIndexOptions): Promise<MarketIndex> {
  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }

  const window = resolveFscMarketSearchWindow(options.now);
  const url = createMarketIndexUrl(options.serviceKey, options.definition, window);
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
      throwAbortReason(options.signal);
    }
    throw new FscMarketProviderError('FSC market request failed');
  }

  if (!response.ok) {
    throw new FscMarketProviderError('FSC market request returned a non-success status');
  }

  let input: unknown;
  try {
    input = await response.json();
  } catch {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new FscMarketProviderError('FSC market response was not valid JSON');
  }

  return normalizeFscMarketIndexResponse(input, options.definition, window);
}

export function readFscMarketCredential(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const credential = environment.DATA_GO_KR_SERVICE_KEY?.trim() ?? '';
  return credential.length === 0 ? undefined : credential;
}
