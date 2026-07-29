// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import * as safetydataModule from '../../../src/server/providers/safetydata';

const safetydata = safetydataModule as Record<string, unknown>;
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/safetydata/disaster-success.json'), 'utf8'),
) as unknown;
const now = Date.parse('2026-07-29T08:00:00.000Z');

describe('Safetydata disaster message normalization', () => {
  it('validates pagination, preserves original fields and sorts the page deterministically', () => {
    const normalize = safetydata.normalizeSafetydataDisasterPage as
      | ((
          input: unknown,
          expected: { numOfRows: number; pageNo: number },
        ) => {
          alerts: readonly {
            id: string;
            issuedAt: number;
            message: string;
            regionText: string;
          }[];
          numOfRows: number;
          pageNo: number;
          totalCount: number;
        })
      | undefined;

    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    const page = normalize(fixture, { numOfRows: 3, pageNo: 1 });
    expect(page).toMatchObject({
      numOfRows: 3,
      pageNo: 1,
      totalCount: 3,
    });
    expect(page.alerts.map((alert) => alert.id)).toEqual(['9003', '9002', '9001']);
    expect(page.alerts[0]).toMatchObject({
      issuedAt: Date.parse('2026-07-29T07:30:00.000Z'),
      message: '[행정안전부]  원문 공백을 그대로 보존합니다.',
      regionText: '서울특별시 전체, 경기도 일부',
    });
    expect(page.alerts[0]).not.toHaveProperty('REG_YMD');
    expect(page.alerts[0]).not.toHaveProperty('MDFCN_YMD');
  });

  it('accepts the provider success header null sentinel observed for errorMsg', () => {
    const normalize = safetydata.normalizeSafetydataDisasterPage as
      | ((
          input: unknown,
          expected: { numOfRows: number; pageNo: number },
        ) => {
          alerts: readonly { id: string }[];
        })
      | undefined;
    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    const observedSuccess = {
      ...(fixture as Record<string, unknown>),
      header: {
        ...(fixture as { header: Record<string, unknown> }).header,
        errorMsg: null,
      },
    };

    expect(normalize(observedSuccess, { numOfRows: 3, pageNo: 1 }).alerts).toHaveLength(3);
  });

  it('accepts the observed nanosecond audit timestamps and rejects impossible calendar values', () => {
    const normalize = safetydata.normalizeSafetydataDisasterPage as
      | ((input: unknown, expected: { numOfRows: number; pageNo: number }) => unknown)
      | undefined;
    expect(normalize).toBeTypeOf('function');
    if (normalize === undefined) {
      return;
    }

    const observedAuditTimestamps = {
      ...(fixture as Record<string, unknown>),
      body: (fixture as { body: readonly Record<string, unknown>[] }).body.map((row) => ({
        ...row,
        MDFCN_YMD: '2026/07/29 16:30:00.000000000',
        REG_YMD: '2026/07/29 16:30:00.000000000',
      })),
    };
    expect(() => normalize(observedAuditTimestamps, { numOfRows: 3, pageNo: 1 })).not.toThrow();

    const impossibleAuditTimestamp = {
      ...observedAuditTimestamps,
      body: (observedAuditTimestamps.body as readonly Record<string, unknown>[]).map((row, index) => ({
        ...row,
        REG_YMD: index === 0 ? '2026/13/29 16:30:00.000000000' : row.REG_YMD,
      })),
    };
    expect(() => normalize(impossibleAuditTimestamp, { numOfRows: 3, pageNo: 1 })).toThrowError(
      'Safetydata disaster registration date is invalid',
    );
  });

  it('uses the exact HTTPS endpoint and a bounded previous-KST-day nationwide request', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: {
          fetcher: typeof fetch;
          now: number;
          serviceKey: string;
          signal: AbortSignal;
        }) => Promise<{ alerts: readonly unknown[] }>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    const serviceKey = 'synthetic-safetydata-secret';
    const controller = new AbortController();
    let requestedUrl: URL | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = new URL(input instanceof URL ? input.href : String(input));
      expect(init).toMatchObject({
        headers: { Accept: 'application/json' },
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      });
      return Response.json({ ...(fixture as Record<string, unknown>), numOfRows: 500 });
    });

    await expect(
      fetchMessages({
        fetcher,
        now,
        serviceKey,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ alerts: [{ id: '9003' }, { id: '9002' }, { id: '9001' }] });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(requestedUrl?.origin).toBe('https://www.safetydata.go.kr');
    expect(requestedUrl?.pathname).toBe('/V2/api/DSSP-IF-00247');
    expect(Object.fromEntries(requestedUrl?.searchParams ?? [])).toEqual({
      crtDt: '20260728',
      numOfRows: '500',
      pageNo: '1',
      returnType: 'json',
      serviceKey,
    });
  });

  it('merges at most two complete pages and returns only the latest fifty unique alerts', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: {
          fetcher: typeof fetch;
          now: number;
          serviceKey: string;
          signal: AbortSignal;
        }) => Promise<{ alerts: readonly { id: string }[] }>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    const firstFixtureRow = (fixture as { body: readonly Record<string, unknown>[] }).body[0];
    expect(firstFixtureRow).toBeDefined();
    if (firstFixtureRow === undefined) {
      return;
    }
    const createRow = (id: number) => ({ ...firstFixtureRow, SN: id });
    const firstPageRows = Array.from({ length: 500 }, (_, index) => createRow(1_000 + index));
    const secondPageRows = [createRow(1_500)];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const pageNo = Number(new URL(input instanceof URL ? input.href : String(input)).searchParams.get('pageNo'));
      return Response.json({
        ...(fixture as Record<string, unknown>),
        body: pageNo === 1 ? firstPageRows : secondPageRows,
        numOfRows: 500,
        pageNo,
        totalCount: 501,
      });
    });

    const result = await fetchMessages({
      fetcher,
      now,
      serviceKey: 'synthetic-safetydata-secret',
      signal: new AbortController().signal,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.alerts).toHaveLength(50);
    expect(result.alerts[0]?.id).toBe('1500');
    expect(result.alerts.at(-1)?.id).toBe('1451');
  });

  it.each([
    ['2026-01-01T14:59:59.000Z', '20251231'],
    ['2026-01-01T15:00:00.000Z', '20260101'],
  ])('uses the previous KST calendar day at the %s boundary', async (currentTime, expectedStart) => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: { fetcher: typeof fetch; now: number; serviceKey: string; signal: AbortSignal }) => Promise<unknown>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    let requestedStart: string | null = null;
    await fetchMessages({
      fetcher: async (input) => {
        requestedStart = new URL(input instanceof URL ? input.href : String(input)).searchParams.get('crtDt');
        return Response.json({ ...(fixture as Record<string, unknown>), numOfRows: 500 });
      },
      now: Date.parse(currentTime),
      serviceKey: 'synthetic-safetydata-secret',
      signal: new AbortController().signal,
    });

    expect(requestedStart).toBe(expectedStart);
  });

  it('rejects an over-limit result and total-count drift without requesting an unbounded page', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: { fetcher: typeof fetch; now: number; serviceKey: string; signal: AbortSignal }) => Promise<unknown>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    const fixtureRow = (fixture as { body: readonly Record<string, unknown>[] }).body[0];
    expect(fixtureRow).toBeDefined();
    if (fixtureRow === undefined) {
      return;
    }
    const createRow = (id: number) => ({ ...fixtureRow, SN: id });
    const firstPage = Array.from({ length: 500 }, (_, index) => createRow(1_000 + index));
    const overLimitFetcher = vi.fn(async () =>
      Response.json({
        ...(fixture as Record<string, unknown>),
        body: firstPage,
        numOfRows: 500,
        pageNo: 1,
        totalCount: 1_001,
      }),
    );
    const options = {
      now,
      serviceKey: 'synthetic-safetydata-secret',
      signal: new AbortController().signal,
    };

    await expect(fetchMessages({ ...options, fetcher: overLimitFetcher })).rejects.toThrowError(
      'Safetydata disaster result exceeds the bounded page limit',
    );
    expect(overLimitFetcher).toHaveBeenCalledOnce();

    const driftingTotalFetcher = vi.fn(async (input: RequestInfo | URL) => {
      const pageNo = Number(new URL(input instanceof URL ? input.href : String(input)).searchParams.get('pageNo'));
      return Response.json({
        ...(fixture as Record<string, unknown>),
        body: pageNo === 1 ? firstPage : [createRow(1_500), createRow(1_501)],
        numOfRows: 500,
        pageNo,
        totalCount: pageNo === 1 ? 501 : 502,
      });
    });
    await expect(fetchMessages({ ...options, fetcher: driftingTotalFetcher })).rejects.toThrowError(
      'Safetydata disaster pagination total changed between pages',
    );
    expect(driftingTotalFetcher).toHaveBeenCalledTimes(2);
  });

  it('deduplicates an identical cross-page serial and rejects an ambiguous duplicate', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: {
          fetcher: typeof fetch;
          now: number;
          serviceKey: string;
          signal: AbortSignal;
        }) => Promise<{ alerts: readonly { id: string }[] }>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    const fixtureRow = (fixture as { body: readonly Record<string, unknown>[] }).body[0];
    expect(fixtureRow).toBeDefined();
    if (fixtureRow === undefined) {
      return;
    }
    const createRow = (id: number) => ({ ...fixtureRow, SN: id });
    const firstPage = Array.from({ length: 500 }, (_, index) => createRow(1_000 + index));
    const fetchWithSecondRow = (secondRow: Record<string, unknown>) => async (input: RequestInfo | URL) => {
      const pageNo = Number(new URL(input instanceof URL ? input.href : String(input)).searchParams.get('pageNo'));
      return Response.json({
        ...(fixture as Record<string, unknown>),
        body: pageNo === 1 ? firstPage : [secondRow],
        numOfRows: 500,
        pageNo,
        totalCount: 501,
      });
    };
    const options = {
      now,
      serviceKey: 'synthetic-safetydata-secret',
      signal: new AbortController().signal,
    };
    const duplicatedTopRow = firstPage.at(-1) ?? createRow(1_499);

    const deduplicated = await fetchMessages({
      ...options,
      fetcher: fetchWithSecondRow(duplicatedTopRow),
    });
    expect(new Set(deduplicated.alerts.map((alert) => alert.id)).size).toBe(deduplicated.alerts.length);

    await expect(
      fetchMessages({
        ...options,
        fetcher: fetchWithSecondRow({
          ...duplicatedTopRow,
          MSG_CN: '같은 식별자에 다른 원문이 들어온 비정상 응답',
        }),
      }),
    ).rejects.toThrowError('Safetydata disaster duplicate serial number is ambiguous');
  });

  it('detects an XML provider error without exposing its body or credential', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: { fetcher: typeof fetch; now: number; serviceKey: string; signal: AbortSignal }) => Promise<unknown>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    const serviceKey = 'synthetic-safetydata-secret';
    const xmlError =
      '<?xml version="1.0"?><response><header><resultCode>30</resultCode><resultMsg>unsafe detail</resultMsg></header></response>';
    let caught: unknown;
    try {
      await fetchMessages({
        fetcher: async () =>
          new Response(xmlError, {
            headers: { 'content-type': 'application/xml;charset=utf-8' },
          }),
        now,
        serviceKey,
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Safetydata disaster provider returned an XML error response');
    expect((caught as Error).message).not.toContain(serviceKey);
    expect((caught as Error).message).not.toContain('unsafe detail');
  });

  it('rejects a JSON-shaped success response with an unapproved MIME type', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: { fetcher: typeof fetch; now: number; serviceKey: string; signal: AbortSignal }) => Promise<unknown>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    await expect(
      fetchMessages({
        fetcher: async () =>
          new Response(JSON.stringify({ ...(fixture as Record<string, unknown>), numOfRows: 500 }), {
            headers: { 'content-type': 'text/html;charset=utf-8' },
          }),
        now,
        serviceKey: 'synthetic-safetydata-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('Safetydata disaster response content type is invalid');
  });

  it('rejects a provider body whose declared size exceeds the bounded parser budget', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: { fetcher: typeof fetch; now: number; serviceKey: string; signal: AbortSignal }) => Promise<unknown>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    await expect(
      fetchMessages({
        fetcher: async () =>
          new Response(JSON.stringify({ ...(fixture as Record<string, unknown>), numOfRows: 500 }), {
            headers: {
              'content-length': String(4 * 1024 * 1024 + 1),
              'content-type': 'application/json;charset=utf-8',
            },
          }),
        now,
        serviceKey: 'synthetic-safetydata-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('Safetydata disaster response size exceeds the allowed limit');
  });

  it('stops reading an undeclared response when the streamed body crosses the same size limit', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: { fetcher: typeof fetch; now: number; serviceKey: string; signal: AbortSignal }) => Promise<unknown>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    await expect(
      fetchMessages({
        fetcher: async () =>
          new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
            headers: { 'content-type': 'application/json' },
          }),
        now,
        serviceKey: 'synthetic-safetydata-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('Safetydata disaster response size exceeds the allowed limit');
  });

  it('reads and documents only the Safetydata-specific server credential identifier', () => {
    const readCredential = safetydata.readSafetydataCredential as
      | ((environment: Readonly<Record<string, string | undefined>>) => string | undefined)
      | undefined;
    expect(readCredential).toBeTypeOf('function');
    if (readCredential === undefined) {
      return;
    }

    expect(readCredential({ SAFETY_DATA_SERVICE_KEY: '  approved-key  ' })).toBe('approved-key');
    expect(readCredential({ DATA_GO_KR_SERVICE_KEY: 'wrong-provider-key' })).toBeUndefined();
    expect(readCredential({ DISASTER_MESSAGE_API_KEY: 'legacy-key' })).toBeUndefined();
    expect(readCredential({ SAFETY_DATA_SERVICE_KEY: '   ' })).toBeUndefined();

    const environmentExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
    expect(environmentExample.split(/\r?\n/)).toContain('SAFETY_DATA_SERVICE_KEY=');
    expect(environmentExample).not.toContain('DISASTER_MESSAGE_API_KEY=');
  });

  it('rejects a response whose final URL does not match the fixed provider endpoint', async () => {
    const fetchMessages = safetydata.fetchSafetydataDisasterMessages as
      | ((options: { fetcher: typeof fetch; now: number; serviceKey: string; signal: AbortSignal }) => Promise<unknown>)
      | undefined;
    expect(fetchMessages).toBeTypeOf('function');
    if (fetchMessages === undefined) {
      return;
    }

    await expect(
      fetchMessages({
        fetcher: async () => {
          const response = Response.json({ ...(fixture as Record<string, unknown>), numOfRows: 500 });
          Object.defineProperty(response, 'url', {
            configurable: true,
            value: 'https://example.invalid/redirected',
          });
          return response;
        },
        now,
        serviceKey: 'synthetic-safetydata-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('Safetydata disaster redirect is not allowed');
  });
});
