import { z } from 'zod';

import type { DisasterAlert } from '../../../entities/disaster/contract';

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const SAFETYDATA_DISASTER_ENDPOINT = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-00247';
const SAFETYDATA_PAGE_SIZE = 500;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(['application/json', 'application/xml', 'text/xml']);

const originalTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'Safetydata original text must not be blank');

const rawAlertSchema = z
  .object({
    CRT_DT: z.string(),
    DST_SE_NM: originalTextSchema(100),
    EMRG_STEP_NM: z.enum(['위급재난', '긴급재난', '안전안내']),
    MDFCN_YMD: z.string(),
    MSG_CN: originalTextSchema(4_000),
    RCPTN_RGN_NM: originalTextSchema(4_000),
    REG_YMD: z.string(),
    SN: z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d{0,21}$/u)]),
  })
  .strict();

const providerResponseSchema = z
  .object({
    body: z.array(rawAlertSchema).nullable(),
    header: z
      .object({
        errorMsg: z.string().max(1_000).nullable(),
        resultCode: z.string().min(1).max(10),
        resultMsg: z.string().max(1_000),
      })
      .strict(),
    numOfRows: z.number().int().positive().safe(),
    pageNo: z.number().int().positive().safe(),
    totalCount: z.number().int().nonnegative().safe(),
  })
  .strict();

export type SafetydataDisasterPage = Readonly<{
  alerts: readonly DisasterAlert[];
  numOfRows: number;
  pageNo: number;
  totalCount: number;
}>;

export type FetchSafetydataDisasterMessagesOptions = Readonly<{
  fetcher: typeof fetch;
  now: number;
  serviceKey: string;
  signal: AbortSignal;
}>;

export class SafetydataDisasterProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SafetydataDisasterProviderError';
  }
}

const parseKstTimestamp = (input: string): number => {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u.exec(input);
  if (match === null) {
    throw new SafetydataDisasterProviderError('Safetydata disaster creation timestamp is invalid');
  }
  const [, yearText = '', monthText = '', dayText = '', hourText = '', minuteText = '', secondText = ''] = match;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const kstCalendar = Date.UTC(year, month, day, hour, minute, second);
  const calendar = new Date(kstCalendar);
  if (
    year < 2023 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    throw new SafetydataDisasterProviderError('Safetydata disaster creation timestamp is invalid');
  }
  return kstCalendar - KST_OFFSET_MS;
};

const assertProviderAuditTimestamp = (input: string, label: string): void => {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(input);
  const timestampMatch = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{9})$/u.exec(input);
  const match = dateOnlyMatch ?? timestampMatch;
  if (match === null) {
    throw new SafetydataDisasterProviderError(`Safetydata disaster ${label} is invalid`);
  }
  const [, yearText = '', monthText = '', dayText = '', hourText = '0', minuteText = '0', secondText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendar = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (
    year < 2023 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    throw new SafetydataDisasterProviderError(`Safetydata disaster ${label} is invalid`);
  }
};

const normalizeId = (input: number | string): string => {
  const value = String(input);
  if (!/^[1-9]\d{0,21}$/u.test(value)) {
    throw new SafetydataDisasterProviderError('Safetydata disaster serial number is invalid');
  }
  return value;
};

const compareAlerts = (left: DisasterAlert, right: DisasterAlert): number => {
  const timeOrder = right.issuedAt - left.issuedAt;
  if (timeOrder !== 0) {
    return timeOrder;
  }
  if (left.id.length !== right.id.length) {
    return right.id.length - left.id.length;
  }
  return right.id.localeCompare(left.id);
};

const formatCompactDate = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
};

const resolveSearchStart = (now: number): string => {
  if (!Number.isSafeInteger(now) || now < Date.UTC(2023, 0, 1)) {
    throw new SafetydataDisasterProviderError('Safetydata disaster search clock is invalid');
  }
  const kstCalendar = new Date(now + KST_OFFSET_MS);
  const currentKstDay = Date.UTC(kstCalendar.getUTCFullYear(), kstCalendar.getUTCMonth(), kstCalendar.getUTCDate());
  return formatCompactDate(currentKstDay - DAY_MS);
};

const createRequestUrl = (serviceKey: string, pageNo: number, searchStart: string): URL => {
  const url = new URL(SAFETYDATA_DISASTER_ENDPOINT);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('returnType', 'json');
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(SAFETYDATA_PAGE_SIZE));
  url.searchParams.set('crtDt', searchStart);
  return url;
};

const readBoundedUtf8 = async (response: Response, signal: AbortSignal): Promise<string> => {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      }
      if (next.done) {
        break;
      }
      received += next.value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SafetydataDisasterProviderError('Safetydata disaster response size exceeds the allowed limit');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    if (error instanceof SafetydataDisasterProviderError) {
      throw error;
    }
    throw new SafetydataDisasterProviderError('Safetydata disaster response body could not be read');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SafetydataDisasterProviderError('Safetydata disaster response is not valid UTF-8');
  }
};

const normalizeAlert = (input: z.infer<typeof rawAlertSchema>): DisasterAlert => {
  assertProviderAuditTimestamp(input.REG_YMD, 'registration date');
  assertProviderAuditTimestamp(input.MDFCN_YMD, 'modification date');
  return {
    disasterType: input.DST_SE_NM,
    emergencyStep: input.EMRG_STEP_NM,
    id: normalizeId(input.SN),
    issuedAt: parseKstTimestamp(input.CRT_DT),
    message: input.MSG_CN,
    regionText: input.RCPTN_RGN_NM,
  };
};

export function normalizeSafetydataDisasterPage(
  input: unknown,
  expected: Readonly<{ numOfRows: number; pageNo: number }>,
): SafetydataDisasterPage {
  let parsed: z.infer<typeof providerResponseSchema>;
  try {
    parsed = providerResponseSchema.parse(input);
  } catch (error) {
    throw new SafetydataDisasterProviderError('Safetydata disaster response is invalid', error);
  }
  if (parsed.header.resultCode !== '00') {
    throw new SafetydataDisasterProviderError('Safetydata disaster provider returned a non-success result');
  }
  if (parsed.pageNo !== expected.pageNo || parsed.numOfRows !== expected.numOfRows) {
    throw new SafetydataDisasterProviderError('Safetydata disaster pagination is inconsistent');
  }

  const rows = parsed.body ?? [];
  const offset = (parsed.pageNo - 1) * parsed.numOfRows;
  const expectedCount = Math.min(parsed.numOfRows, Math.max(0, parsed.totalCount - offset));
  if (rows.length !== expectedCount || (parsed.totalCount === 0) !== (parsed.body === null)) {
    throw new SafetydataDisasterProviderError('Safetydata disaster pagination is incomplete');
  }

  const alertsById = new Map<string, DisasterAlert>();
  for (const row of rows) {
    const alert = normalizeAlert(row);
    const existing = alertsById.get(alert.id);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(alert)) {
      throw new SafetydataDisasterProviderError('Safetydata disaster duplicate serial number is ambiguous');
    }
    alertsById.set(alert.id, alert);
  }

  return {
    alerts: [...alertsById.values()].sort(compareAlerts),
    numOfRows: parsed.numOfRows,
    pageNo: parsed.pageNo,
    totalCount: parsed.totalCount,
  };
}

export async function fetchSafetydataDisasterMessages(
  options: FetchSafetydataDisasterMessagesOptions,
): Promise<Readonly<{ alerts: readonly DisasterAlert[] }>> {
  if (options.signal.aborted) {
    throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }
  const searchStart = resolveSearchStart(options.now);
  const fetchPage = async (pageNo: number): Promise<SafetydataDisasterPage> => {
    const url = createRequestUrl(options.serviceKey, pageNo, searchStart);
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
        throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      }
      throw new SafetydataDisasterProviderError('Safetydata disaster request failed');
    }
    if (response.redirected || (response.url !== '' && response.url !== url.href)) {
      throw new SafetydataDisasterProviderError('Safetydata disaster redirect is not allowed');
    }
    if (!response.ok) {
      throw new SafetydataDisasterProviderError('Safetydata disaster request returned a non-success status');
    }
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new SafetydataDisasterProviderError('Safetydata disaster response content type is invalid');
    }
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES) {
        throw new SafetydataDisasterProviderError('Safetydata disaster response size exceeds the allowed limit');
      }
    }

    let body: string;
    try {
      body = await readBoundedUtf8(response, options.signal);
    } catch (error) {
      if (options.signal.aborted) {
        throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      }
      if (error instanceof SafetydataDisasterProviderError) {
        throw error;
      }
      throw new SafetydataDisasterProviderError('Safetydata disaster response body could not be read');
    }
    if (/^\s*</u.test(body)) {
      throw new SafetydataDisasterProviderError('Safetydata disaster provider returned an XML error response');
    }

    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new SafetydataDisasterProviderError('Safetydata disaster response was not valid JSON');
    }
    return normalizeSafetydataDisasterPage(input, {
      numOfRows: SAFETYDATA_PAGE_SIZE,
      pageNo,
    });
  };

  const firstPage = await fetchPage(1);
  if (firstPage.totalCount > SAFETYDATA_PAGE_SIZE * 2) {
    throw new SafetydataDisasterProviderError('Safetydata disaster result exceeds the bounded page limit');
  }
  const pages = [firstPage];
  if (firstPage.totalCount > SAFETYDATA_PAGE_SIZE) {
    const secondPage = await fetchPage(2);
    if (secondPage.totalCount !== firstPage.totalCount) {
      throw new SafetydataDisasterProviderError('Safetydata disaster pagination total changed between pages');
    }
    pages.push(secondPage);
  }

  const alertsById = new Map<string, DisasterAlert>();
  for (const alert of pages.flatMap((page) => page.alerts)) {
    const existing = alertsById.get(alert.id);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(alert)) {
      throw new SafetydataDisasterProviderError('Safetydata disaster duplicate serial number is ambiguous');
    }
    alertsById.set(alert.id, alert);
  }
  return {
    alerts: [...alertsById.values()].sort(compareAlerts).slice(0, 50),
  };
}

export function readSafetydataCredential(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const credential = environment.SAFETY_DATA_SERVICE_KEY?.trim() ?? '';
  return credential.length === 0 ? undefined : credential;
}
