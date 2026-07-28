import { z } from 'zod';

import type { MACRO_SERIES, MacroSeries, MacroSeriesDefinition } from '../../../entities/macro/contract';

const ECOS_STATISTIC_SEARCH_ENDPOINT = 'https://ecos.bok.or.kr/api/StatisticSearch';
const ECOS_PAGE_SIZE = 100;
const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

const providerValueSchema = z.union([z.string(), z.number().finite()]);
const nullableProviderTextSchema = z.string().nullable();

const providerRowSchema = z
  .object({
    DATA_VALUE: providerValueSchema,
    ITEM_CODE1: z.string(),
    ITEM_CODE2: nullableProviderTextSchema,
    ITEM_CODE3: nullableProviderTextSchema,
    ITEM_CODE4: nullableProviderTextSchema,
    ITEM_NAME1: z.string(),
    ITEM_NAME2: nullableProviderTextSchema,
    ITEM_NAME3: nullableProviderTextSchema,
    ITEM_NAME4: nullableProviderTextSchema,
    STAT_CODE: z.string(),
    STAT_NAME: z.string(),
    TIME: z.string(),
    UNIT_NAME: z.string(),
    WGT: nullableProviderTextSchema,
  })
  .strict();

const providerSuccessSchema = z
  .object({
    StatisticSearch: z
      .object({
        list_total_count: providerValueSchema,
        row: z.array(providerRowSchema),
      })
      .strict(),
  })
  .strict();

const providerResultSchema = z
  .object({
    RESULT: z
      .object({
        CODE: z.string(),
        MESSAGE: z.string(),
      })
      .strict(),
  })
  .strict();

type ProviderRow = z.infer<typeof providerRowSchema>;
type EcosSearchWindow = Readonly<{ from: string; to: string }>;

export type FetchEcosMacroSeriesOptions = Readonly<{
  fetcher: typeof fetch;
  now: number;
  series: (typeof MACRO_SERIES)[number];
  serviceKey: string;
  signal: AbortSignal;
}>;

export class EcosMacroProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'EcosMacroProviderError';
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const parseSafeInteger = (input: string | number, label: string): number => {
  const serialized = String(input).trim();
  if (!/^\d+$/.test(serialized)) {
    throw new EcosMacroProviderError(`ECOS ${label} is invalid`);
  }
  const value = Number(serialized);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EcosMacroProviderError(`ECOS ${label} is invalid`);
  }
  return value;
};

const parseFiniteNumber = (input: string | number): number => {
  const serialized = String(input).trim();
  if (!numericPattern.test(serialized)) {
    throw new EcosMacroProviderError('ECOS observation value is invalid');
  }
  const value = Number(serialized);
  if (!Number.isFinite(value)) {
    throw new EcosMacroProviderError('ECOS observation value is invalid');
  }
  return value;
};

const assertPeriod = (period: string, cycle: MacroSeriesDefinition['cycle']): void => {
  if (cycle === 'D') {
    if (!/^\d{8}$/.test(period)) {
      throw new EcosMacroProviderError('ECOS daily period is invalid');
    }
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(4, 6));
    const day = Number(period.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      year < 2000 ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new EcosMacroProviderError('ECOS daily period is invalid');
    }
    return;
  }

  if (!/^\d{6}$/.test(period)) {
    throw new EcosMacroProviderError('ECOS monthly period is invalid');
  }
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  if (year < 2000 || month < 1 || month > 12) {
    throw new EcosMacroProviderError('ECOS monthly period is invalid');
  }
};

const hasUnusedItemDimensions = (row: ProviderRow): boolean =>
  [row.ITEM_CODE2, row.ITEM_CODE3, row.ITEM_CODE4].some((itemCode) => itemCode !== null && itemCode.trim().length > 0);

const normalizeAvailableSeries = (
  series: (typeof MACRO_SERIES)[number],
  rows: readonly ProviderRow[],
  window?: EcosSearchWindow,
): MacroSeries => {
  const periods = new Set<string>();
  let latest:
    | Readonly<{
        period: string;
        sourceValue: number;
      }>
    | undefined;

  for (const row of rows) {
    if (
      row.STAT_CODE.trim() !== series.statCode ||
      row.ITEM_CODE1.trim() !== series.itemCode ||
      row.UNIT_NAME.trim() !== series.sourceUnit ||
      hasUnusedItemDimensions(row)
    ) {
      throw new EcosMacroProviderError('ECOS observation metadata does not match the requested series');
    }

    const period = row.TIME.trim();
    assertPeriod(period, series.cycle);
    if (window !== undefined && (period < window.from || period > window.to)) {
      throw new EcosMacroProviderError('ECOS observation falls outside the requested search window');
    }
    if (periods.has(period)) {
      throw new EcosMacroProviderError('ECOS response contains an ambiguous duplicate period');
    }
    periods.add(period);

    const sourceValue = parseFiniteNumber(row.DATA_VALUE);
    if (latest === undefined || period > latest.period) {
      latest = { period, sourceValue };
    }
  }

  if (latest === undefined) {
    throw new EcosMacroProviderError('ECOS success response contains no observations');
  }

  return {
    ...series,
    observation: {
      period: latest.period,
      sourceValue: latest.sourceValue,
      value: series.id === 'fx-reserves' ? latest.sourceValue / 100_000 : latest.sourceValue,
    },
    status: 'available',
  };
};

export function normalizeEcosMacroResponse(
  input: unknown,
  series: (typeof MACRO_SERIES)[number],
  window?: EcosSearchWindow,
): MacroSeries {
  const result = providerResultSchema.safeParse(input);
  if (result.success) {
    if (result.data.RESULT.CODE !== 'INFO-200') {
      throw new EcosMacroProviderError('ECOS provider returned a non-success result');
    }
    return {
      ...series,
      observation: null,
      status: 'empty',
    };
  }

  let success: z.infer<typeof providerSuccessSchema>;
  try {
    success = providerSuccessSchema.parse(input);
  } catch (error) {
    throw new EcosMacroProviderError('ECOS StatisticSearch response is invalid', error);
  }

  const totalCount = parseSafeInteger(success.StatisticSearch.list_total_count, 'pagination total');
  const rows = success.StatisticSearch.row;
  if (totalCount === 0 || totalCount > ECOS_PAGE_SIZE || totalCount !== rows.length) {
    throw new EcosMacroProviderError('ECOS pagination is invalid');
  }

  return normalizeAvailableSeries(series, rows, window);
}

const formatDailyPeriod = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
};

const formatMonthlyPeriod = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const resolveEcosSearchWindow = (
  now: number,
  cycle: MacroSeriesDefinition['cycle'],
): Readonly<{ from: string; to: string }> => {
  if (!Number.isSafeInteger(now) || now < Date.UTC(2000, 0, 1)) {
    throw new EcosMacroProviderError('ECOS search clock is invalid');
  }

  const kstCalendar = new Date(now + KST_OFFSET_MS);
  const currentDay = Date.UTC(kstCalendar.getUTCFullYear(), kstCalendar.getUTCMonth(), kstCalendar.getUTCDate());
  if (cycle === 'D') {
    return {
      from: formatDailyPeriod(currentDay - 45 * DAY_MS),
      to: formatDailyPeriod(currentDay),
    };
  }

  const currentMonth = Date.UTC(kstCalendar.getUTCFullYear(), kstCalendar.getUTCMonth(), 1);
  return {
    from: formatMonthlyPeriod(
      Date.UTC(new Date(currentMonth).getUTCFullYear(), new Date(currentMonth).getUTCMonth() - 17, 1),
    ),
    to: formatMonthlyPeriod(currentMonth),
  };
};

const createStatisticSearchUrl = (
  serviceKey: string,
  series: (typeof MACRO_SERIES)[number],
  window: Readonly<{ from: string; to: string }>,
): URL => {
  const key = serviceKey.trim();
  if (key.length === 0) {
    throw new EcosMacroProviderError('ECOS credential is missing');
  }

  const path = [
    ECOS_STATISTIC_SEARCH_ENDPOINT,
    encodeURIComponent(key),
    'json',
    'kr',
    '1',
    String(ECOS_PAGE_SIZE),
    series.statCode,
    series.cycle,
    window.from,
    window.to,
    series.itemCode,
    '',
  ].join('/');
  return new URL(path);
};

export async function fetchEcosMacroSeries(options: FetchEcosMacroSeriesOptions): Promise<MacroSeries> {
  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }

  const window = resolveEcosSearchWindow(options.now, options.series.cycle);
  const url = createStatisticSearchUrl(options.serviceKey, options.series, window);
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
    throw new EcosMacroProviderError('ECOS StatisticSearch request failed');
  }

  if (!response.ok) {
    throw new EcosMacroProviderError('ECOS StatisticSearch request returned a non-success status');
  }

  let input: unknown;
  try {
    input = await response.json();
  } catch {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new EcosMacroProviderError('ECOS StatisticSearch response was not valid JSON');
  }

  return normalizeEcosMacroResponse(input, options.series, window);
}

export function readEcosCredential(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const credential = environment.ECOS_API_KEY?.trim() ?? '';
  return credential.length === 0 ? undefined : credential;
}
