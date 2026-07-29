import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';

import type { NewsItem, PublicPressSourceId } from '../../../entities/news/contract';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(['application/rss+xml', 'application/xml', 'text/xml']);
const KST_OFFSET_MS = 9 * 60 * 60_000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTHS = new Map(
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map(
    (month, index) => [month, index] as const,
  ),
);

export const PUBLIC_PRESS_FEEDS = Object.freeze([
  Object.freeze({ id: 'mcst', url: 'https://www.mcst.go.kr/common/rss/press.jsp' }),
  Object.freeze({ id: 'mois', url: 'https://www.mois.go.kr/gpms/view/jsp/rss/rss.jsp?ctxCd=1012' }),
] as const);

export type PublicPressFeedDefinition = (typeof PUBLIC_PRESS_FEEDS)[number];

export type FetchPublicPressFeedOptions = Readonly<{
  definition: PublicPressFeedDefinition;
  fetcher: typeof fetch;
  signal: AbortSignal;
}>;

export class PublicPressProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicPressProviderError';
  }
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const assertDefinition = (definition: PublicPressFeedDefinition): void => {
  const approved = PUBLIC_PRESS_FEEDS.find(
    (candidate) => candidate.id === definition.id && candidate.url === definition.url,
  );
  if (approved === undefined) {
    throw new PublicPressProviderError('Public press feed definition is not approved');
  }
};

const assertContentType = (response: Response): void => {
  const header = response.headers.get('content-type') ?? '';
  const [rawType, ...parameters] = header.split(';');
  if (!ALLOWED_CONTENT_TYPES.has(rawType?.trim().toLowerCase() ?? '')) {
    throw new PublicPressProviderError('Public press RSS content type is invalid');
  }

  const charset = parameters
    .map((parameter) => parameter.trim().toLowerCase())
    .find((parameter) => parameter.startsWith('charset='))
    ?.slice('charset='.length)
    .replaceAll('"', '');
  if (charset !== undefined && charset !== 'utf-8' && charset !== 'utf8') {
    throw new PublicPressProviderError('Public press RSS charset is invalid');
  }
};

const parseDeclaredLength = (response: Response): number | undefined => {
  const rawLength = response.headers.get('content-length');
  if (rawLength === null) {
    return undefined;
  }
  if (!/^\d+$/u.test(rawLength)) {
    throw new PublicPressProviderError('Public press RSS response size is invalid');
  }
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length > MAX_RESPONSE_BYTES) {
    throw new PublicPressProviderError('Public press RSS response size exceeds the allowed limit');
  }
  return length;
};

const readBoundedUtf8 = async (response: Response, signal: AbortSignal): Promise<string> => {
  parseDeclaredLength(response);
  if (signal.aborted) {
    throwAbortReason(signal);
  }

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
        throwAbortReason(signal);
      }
      if (next.done) {
        break;
      }
      received += next.value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PublicPressProviderError('Public press RSS response size exceeds the allowed limit');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (signal.aborted) {
      throwAbortReason(signal);
    }
    if (error instanceof PublicPressProviderError) {
      throw error;
    }
    throw new PublicPressProviderError('Public press RSS response body could not be read');
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
    throw new PublicPressProviderError('Public press RSS response is not valid UTF-8');
  }
};

const directElements = (parent: XmlNode, name?: string): XmlElement[] => {
  const elements: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1 && (name === undefined || child.nodeName === name)) {
      elements.push(child as XmlElement);
    }
  }
  return elements;
};

const readSingleTextElement = (parent: XmlNode, name: string): string => {
  const matches = directElements(parent, name);
  if (matches.length !== 1) {
    throw new PublicPressProviderError(`Public press RSS item ${name} is invalid`);
  }
  const element = matches[0];
  if (element === undefined || directElements(element).length > 0) {
    throw new PublicPressProviderError(`Public press RSS item ${name} is invalid`);
  }
  const value = (element.textContent ?? '').replace(/\s+/gu, ' ').trim();
  if (value.length === 0) {
    throw new PublicPressProviderError(`Public press RSS item ${name} is invalid`);
  }
  return value;
};

const parseKstDate = (input: string): number => {
  const match =
    /^(sun|mon|tue|wed|thu|fri|sat),\s+(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+KST$/iu.exec(
      input,
    );
  if (match === null) {
    throw new PublicPressProviderError('Public press RSS KST publication date is invalid');
  }

  const [
    ,
    weekdayText = '',
    dayText = '',
    monthText = '',
    yearText = '',
    hourText = '',
    minuteText = '',
    secondText = '',
  ] = match;
  const year = Number(yearText);
  const month = MONTHS.get(monthText.toLowerCase());
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month === undefined || year < 1970 || hour > 23 || minute > 59 || second > 59) {
    throw new PublicPressProviderError('Public press RSS KST publication date is invalid');
  }

  const kstCalendar = Date.UTC(year, month, day, hour, minute, second);
  const calendar = new Date(kstCalendar);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month ||
    calendar.getUTCDate() !== day ||
    WEEKDAYS[calendar.getUTCDay()] !== weekdayText.toLowerCase()
  ) {
    throw new PublicPressProviderError('Public press RSS KST publication date is invalid');
  }
  return kstCalendar - KST_OFFSET_MS;
};

const parsePositiveId = (value: string): string => {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new PublicPressProviderError('Public press RSS item link identifier is invalid');
  }
  return value;
};

const assertExactQuery = (url: URL, expectedKeys: readonly string[]): void => {
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== expectedKeys.length ||
    new Set(keys).size !== expectedKeys.length ||
    expectedKeys.some((key) => !url.searchParams.has(key))
  ) {
    throw new PublicPressProviderError('Public press RSS item link query is invalid');
  }
};

const normalizeMcstLink = (input: string): Readonly<{ id: string; originalUrl: string }> => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PublicPressProviderError('Public press RSS item link is invalid');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.hostname.toLowerCase() !== 'www.mcst.go.kr' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.pathname !== '/web/s_notice/press/pressView.jsp'
  ) {
    throw new PublicPressProviderError('Public press RSS item link is not allowed');
  }
  assertExactQuery(url, ['pMenuCD', 'pSeq']);
  if (url.searchParams.get('pMenuCD') !== '0302000000') {
    throw new PublicPressProviderError('Public press RSS item link menu is invalid');
  }
  const id = parsePositiveId(url.searchParams.get('pSeq') ?? '');
  return {
    id: `mcst:${id}`,
    originalUrl: `https://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=${id}`,
  };
};

const normalizeMoisLink = (input: string): Readonly<{ id: string; originalUrl: string }> => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PublicPressProviderError('Public press RSS item link is invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'www.mois.go.kr' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.pathname !== '/frt/bbs/type010/commonSelectBoardArticle.do'
  ) {
    throw new PublicPressProviderError('Public press RSS item link is not allowed');
  }
  assertExactQuery(url, ['bbsId', 'nttId']);
  if (url.searchParams.get('bbsId') !== 'BBSMSTR_000000000008') {
    throw new PublicPressProviderError('Public press RSS item link board is invalid');
  }
  const id = parsePositiveId(url.searchParams.get('nttId') ?? '');
  return {
    id: `mois:1012:${id}`,
    originalUrl: `https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=${id}`,
  };
};

const parseItem = (element: XmlElement, sourceId: PublicPressSourceId): NewsItem => {
  const title = readSingleTextElement(element, 'title');
  if (title.length > 200) {
    throw new PublicPressProviderError('Public press RSS item title is too long');
  }
  const rawLink = readSingleTextElement(element, 'link');
  const link = sourceId === 'mcst' ? normalizeMcstLink(rawLink) : normalizeMoisLink(rawLink);
  return {
    ...link,
    publishedAt: parseKstDate(readSingleTextElement(element, 'pubDate')),
    sourceId,
    title,
  };
};

const assertNoXmlDeclarations = (input: string): void => {
  const structuralText = input.replace(/<!--[\s\S]*?-->/gu, '').replace(/<\?[\s\S]*?\?>/gu, '');
  const documentElementIndex = structuralText.search(/<[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s|\/?>)/u);
  const prolog = structuralText.slice(0, documentElementIndex === -1 ? undefined : documentElementIndex);

  if (/<!DOCTYPE\b|<!ENTITY\b/iu.test(prolog)) {
    throw new PublicPressProviderError('Public press RSS document type is not allowed');
  }
};

const parseRss = (input: string, sourceId: PublicPressSourceId): NewsItem[] => {
  assertNoXmlDeclarations(input);

  let document: XmlDocument;
  try {
    document = new DOMParser({
      locator: false,
      onError() {
        throw new Error('invalid XML');
      },
    }).parseFromString(input, 'application/xml');
  } catch {
    throw new PublicPressProviderError('Public press RSS XML is malformed');
  }
  if (document.doctype !== null) {
    throw new PublicPressProviderError('Public press RSS document type is not allowed');
  }

  const root = document.documentElement;
  if (root === null || root.nodeName !== 'rss' || root.getAttribute('version') !== '2.0') {
    throw new PublicPressProviderError('Public press RSS 2.0 root is invalid');
  }
  const channels = directElements(root, 'channel');
  if (channels.length !== 1 || directElements(root).length !== 1) {
    throw new PublicPressProviderError('Public press RSS 2.0 channel is invalid');
  }
  const channel = channels[0];
  if (channel === undefined) {
    throw new PublicPressProviderError('Public press RSS 2.0 channel is invalid');
  }

  const items = directElements(channel, 'item')
    .map((item) => parseItem(item, sourceId))
    .sort((left, right) => right.publishedAt - left.publishedAt || left.id.localeCompare(right.id));
  const ids = new Set<string>();
  const urls = new Set<string>();
  return items.filter((item) => {
    if (ids.has(item.id) || urls.has(item.originalUrl)) {
      return false;
    }
    ids.add(item.id);
    urls.add(item.originalUrl);
    return true;
  });
};

export async function fetchPublicPressFeed(
  options: FetchPublicPressFeedOptions,
): Promise<Readonly<{ items: NewsItem[] }>> {
  assertDefinition(options.definition);
  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }

  let response: Response;
  try {
    response = await options.fetcher(options.definition.url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      method: 'GET',
      redirect: 'error',
      signal: options.signal,
    });
  } catch {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new PublicPressProviderError('Public press RSS request failed');
  }

  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }
  if (!response.ok) {
    throw new PublicPressProviderError('Public press RSS request returned a non-success status');
  }
  if (response.redirected || (response.url !== '' && response.url !== options.definition.url)) {
    throw new PublicPressProviderError('Public press RSS redirect is not allowed');
  }
  assertContentType(response);
  const body = await readBoundedUtf8(response, options.signal);
  return { items: parseRss(body, options.definition.id) };
}
