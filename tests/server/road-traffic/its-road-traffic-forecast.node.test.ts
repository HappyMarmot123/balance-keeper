// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import * as itsProviderModule from '../../../src/server/providers/its';

const itsProvider = itsProviderModule as Readonly<Record<string, unknown>>;
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-forecast-success.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const requestedAt = Date.parse('2026-08-03T15:20:00+09:00');

type FetchForecast = (
  options: Readonly<{
    fetcher: typeof fetch;
    now: number;
    serviceKey: string;
    signal: AbortSignal;
  }>,
) => Promise<unknown>;

const cloneFixture = (): Record<string, unknown> => structuredClone(fixture);
const fixtureHeader = (input: Record<string, unknown>) => input.header as Record<string, unknown>;
const fixtureBody = (input: Record<string, unknown>) => input.body as Record<string, unknown>;
const fixtureRows = (input: Record<string, unknown>) => fixtureBody(input).items as Record<string, unknown>[];
const updateFirstFixtureRow = (input: Record<string, unknown>, field: string, value: unknown): void => {
  const row = fixtureRows(input)[0];
  if (row === undefined) {
    throw new Error('Synthetic ITS fixture must contain a row');
  }
  row[field] = value;
};
const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

describe('ITS road traffic forecast provider', () => {
  it('requests the fixed product section and current KST hour without undocumented routeNo', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    expect(itsProvider.ITS_ROAD_TRAFFIC_FORECAST_SECTION_ID).toBe('1');
    if (fetchForecast === undefined) {
      return;
    }

    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(fixture));
    await expect(
      fetchForecast({
        fetcher,
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      forecastAt: Date.parse('2026-08-03T15:00:00+09:00'),
      sectionId: '1',
      segments: [
        {
          linkId: 'LINK-001',
          sectionTypeCode: 'D',
          speed: 72.5,
          speedUnit: 'provider-unspecified',
        },
        {
          linkId: 'LINK-002',
          sectionTypeCode: 'M',
          speed: 80,
          speedUnit: 'provider-unspecified',
        },
      ],
    });

    const [requestUrl, requestInit] = fetcher.mock.calls[0] ?? [];
    expect(requestUrl).toBeInstanceOf(URL);
    const url = requestUrl as URL;
    expect(url.origin).toBe('https://openapi.its.go.kr:9443');
    expect(url.pathname).toBe('/bypassFCastInfo');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      apiKey: 'synthetic-its-secret',
      fCastDate: '20260803',
      fCastHour: '15',
      getType: 'json',
      sectionId: '1',
    });
    expect(url.searchParams.has('routeNo')).toBe(false);
    expect(requestInit).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  });

  it('uses the next KST date at the UTC day boundary', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }

    const input = cloneFixture();
    for (const row of fixtureRows(input)) {
      row.fcastDate = '20260804';
      row.fcastHour = '00';
    }
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(input));
    const now = Date.parse('2026-08-03T15:30:00.000Z');
    await expect(
      fetchForecast({ fetcher, now, serviceKey: 'synthetic-its-secret', signal: new AbortController().signal }),
    ).resolves.toMatchObject({ forecastAt: Date.parse('2026-08-04T00:00:00+09:00') });
    const requestUrl = fetcher.mock.calls[0]?.[0] as URL;
    expect(requestUrl.searchParams.get('fCastDate')).toBe('20260804');
    expect(requestUrl.searchParams.get('fCastHour')).toBe('00');
  });

  it('accepts a complete nested envelope, singleton row and atomic empty snapshot', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }

    const single = cloneFixture();
    const firstRow = fixtureRows(single)[0];
    expect(firstRow).toBeDefined();
    if (firstRow === undefined) {
      return;
    }
    const nested = {
      response: {
        header: fixtureHeader(single),
        body: { items: { item: firstRow }, totalCount: 1 },
      },
    };
    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(nested),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ segments: [{ linkId: firstRow.linkId }] });

    const empty = { header: fixtureHeader(single), body: { items: [], totalCount: '0' } };
    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(empty),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      forecastAt: Date.parse('2026-08-03T15:00:00+09:00'),
      sectionId: '1',
      segments: [],
    });
  });

  it('accepts the strict flat data envelope without mixing envelope branches', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const input = cloneFixture();
    const flat = {
      data: fixtureRows(input),
      resultCode: fixtureHeader(input).resultCode,
      resultMsg: fixtureHeader(input).resultMsg,
      totalCount: fixtureBody(input).totalCount,
    };

    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(flat),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ segments: [{ linkId: 'LINK-001' }, { linkId: 'LINK-002' }] });
  });

  it('accepts complete body.data and response.data envelope variants', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const input = cloneFixture();
    const rows = fixtureRows(input);
    fixtureBody(input).data = rows;
    delete fixtureBody(input).items;
    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(input),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ segments: [{ linkId: 'LINK-001' }, { linkId: 'LINK-002' }] });

    const responseData = {
      response: {
        body: { totalCount: fixtureBody(input).totalCount },
        data: rows,
        header: fixtureHeader(input),
      },
    };
    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(responseData),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ segments: [{ linkId: 'LINK-001' }, { linkId: 'LINK-002' }] });
  });

  it('accepts an explicit empty items object only with zero totalCount', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const input = cloneFixture();
    fixtureBody(input).items = {};
    fixtureBody(input).totalCount = '0';

    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(input),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ segments: [] });
  });

  it.each(['absent', 'null'] as const)('accepts %s items only with zero totalCount', async (shape) => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const input = cloneFixture();
    fixtureBody(input).totalCount = '0';
    if (shape === 'absent') {
      delete fixtureBody(input).items;
    } else {
      fixtureBody(input).items = null;
    }

    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(input),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ segments: [] });
  });

  it('accepts a null nested item only with zero totalCount', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const input = cloneFixture();
    fixtureBody(input).items = { item: null };
    fixtureBody(input).totalCount = '0';

    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(input),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ segments: [] });
  });

  it('pins a finite response byte cap before JSON parsing', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(itsProvider.ITS_ROAD_TRAFFIC_FORECAST_MAX_RESPONSE_BYTES).toBe(256 * 1024);
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }

    const options = {
      fetcher: async () => jsonResponse(fixture),
      now: requestedAt,
      serviceKey: 'synthetic-its-secret',
      signal: new AbortController().signal,
    } as const;
    await expect(
      fetchForecast({
        ...options,
        fetcher: async () => jsonResponse(fixture, { headers: { 'content-length': String(256 * 1024 + 1) } }),
      }),
    ).rejects.toThrowError('ITS road traffic forecast response size exceeds the allowed limit');
    await expect(
      fetchForecast({
        ...options,
        fetcher: async () =>
          new Response(new Uint8Array(256 * 1024 + 1), {
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toThrowError('ITS road traffic forecast response size exceeds the allowed limit');
  });

  it('rejects redirect, MIME, status and malformed JSON without exposing upstream content', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const base = {
      now: requestedAt,
      serviceKey: 'synthetic-its-secret',
      signal: new AbortController().signal,
    };

    await expect(
      fetchForecast({ ...base, fetcher: async () => new Response('{}', { headers: { 'content-type': 'text/html' } }) }),
    ).rejects.toThrowError('ITS road traffic forecast response content type is invalid');
    await expect(
      fetchForecast({ ...base, fetcher: async () => jsonResponse({}, { status: 502 }) }),
    ).rejects.toThrowError('ITS road traffic forecast request returned a non-success status');
    await expect(
      fetchForecast({
        ...base,
        fetcher: async () => {
          const response = jsonResponse(fixture);
          Object.defineProperty(response, 'url', { value: 'https://example.invalid/redirected' });
          return response;
        },
      }),
    ).rejects.toThrowError('ITS road traffic forecast redirect is not allowed');

    let caught: unknown;
    try {
      await fetchForecast({
        ...base,
        fetcher: async () =>
          new Response('{"providerSecret":"unsafe-fragment"', {
            headers: { 'content-type': 'application/json' },
          }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('ITS road traffic forecast response was not valid JSON');
    expect((caught as Error).message).not.toContain('unsafe-fragment');
  });

  it('requires exact HTTP 200 instead of accepting partial 206 content', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }

    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(fixture, { status: 206 }),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('ITS road traffic forecast request returned a non-success status');
  });

  it('rejects provider failure without exposing resultMsg', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const input = cloneFixture();
    fixtureHeader(input).resultCode = '1';
    fixtureHeader(input).resultMsg = 'unsafe account detail';

    let caught: unknown;
    try {
      await fetchForecast({
        fetcher: async () => jsonResponse(input),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('ITS road traffic forecast provider returned a non-success result');
    expect((caught as Error).message).not.toContain('unsafe account detail');
  });

  it('fails closed when a successful provider body reflects the credential', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const serviceKey = 'synthetic-reflected-secret';
    const input = cloneFixture();
    updateFirstFixtureRow(input, 'linkId', serviceKey);

    let caught: unknown;
    try {
      await fetchForecast({
        fetcher: async () => jsonResponse(input),
        now: requestedAt,
        serviceKey,
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('ITS road traffic forecast response is invalid');
    expect((caught as Error).message).not.toContain(serviceKey);
  });

  it('fails closed when JSON escaping hides a reflected credential in raw text', async () => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const serviceKey = 'S3CRET';
    const input = cloneFixture();
    updateFirstFixtureRow(input, 'linkId', serviceKey);
    const escapedKey = [...serviceKey]
      .map((character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0')}`)
      .join('');
    const body = JSON.stringify(input).replace(`"${serviceKey}"`, `"${escapedKey}"`);
    expect(body).not.toContain(serviceKey);

    await expect(
      fetchForecast({
        fetcher: async () =>
          new Response(body, {
            headers: { 'content-type': 'application/json' },
          }),
        now: requestedAt,
        serviceKey,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('ITS road traffic forecast response is invalid');
  });

  it.each([
    ['a mismatched count', (input: Record<string, unknown>) => (fixtureBody(input).totalCount = '3')],
    ['a mismatched section', (input: Record<string, unknown>) => updateFirstFixtureRow(input, 'sectionId', '2')],
    ['a mismatched date', (input: Record<string, unknown>) => updateFirstFixtureRow(input, 'fcastDate', '20260804')],
    ['a mismatched hour', (input: Record<string, unknown>) => updateFirstFixtureRow(input, 'fcastHour', '16')],
    [
      'a duplicate composite segment identity',
      (input: Record<string, unknown>) => {
        const rows = fixtureRows(input);
        const first = rows[0];
        if (first === undefined) {
          throw new Error('Synthetic ITS fixture must contain a row');
        }
        rows.push(structuredClone(first));
        fixtureBody(input).totalCount = String(rows.length);
      },
    ],
    [
      'an unsupported section type',
      (input: Record<string, unknown>) => updateFirstFixtureRow(input, 'sectionType', 'X'),
    ],
    ['an out-of-range speed', (input: Record<string, unknown>) => updateFirstFixtureRow(input, 'speed', '301')],
    ['an undocumented field', (input: Record<string, unknown>) => updateFirstFixtureRow(input, 'rawUnit', 'km/h')],
  ])('rejects %s instead of guessing', async (_label, mutate) => {
    const fetchForecast = itsProvider.fetchItsRoadTrafficForecast as FetchForecast | undefined;
    expect(fetchForecast).toBeTypeOf('function');
    if (fetchForecast === undefined) {
      return;
    }
    const input = cloneFixture();
    mutate(input);
    await expect(
      fetchForecast({
        fetcher: async () => jsonResponse(input),
        now: requestedAt,
        serviceKey: 'synthetic-its-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError(/ITS road traffic forecast/u);
  });
});
