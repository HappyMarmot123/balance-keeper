// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import * as itsProviderModule from '../../../src/server/providers/its';

const itsProvider = itsProviderModule as Readonly<Record<string, unknown>>;
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-traffic-detectors-success.json', import.meta.url), 'utf8'),
) as { body: { items: Record<string, unknown>[]; totalCount: string }; header: Record<string, unknown> };
const generatedAt = Date.parse('2026-08-07T12:02:00+09:00');
const serviceKey = 'synthetic-its-secret';

type FetchDetectors = (
  options: Readonly<{
    fetcher: typeof fetch;
    now: number;
    serviceKey: string;
    signal: AbortSignal;
  }>,
) => Promise<unknown>;

const cloneFixture = () => structuredClone(fixture);
const updateFirstRow = (input: ReturnType<typeof cloneFixture>, field: string, value: unknown): void => {
  const row = input.body.items[0];
  if (row === undefined) throw new Error('Synthetic detector fixture must contain a row');
  row[field] = value;
};
const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
const getFetcher = (): FetchDetectors | undefined =>
  itsProvider.fetchItsRoadTrafficDetectors as FetchDetectors | undefined;

describe('ITS road traffic detector provider', () => {
  it('requests the nationwide query-free vdsInfo endpoint once and compactly normalizes every row', async () => {
    const fetchDetectors = getFetcher();
    expect(fetchDetectors).toBeTypeOf('function');
    expect(itsProvider.ITS_ROAD_TRAFFIC_DETECTOR_MAX_RESPONSE_BYTES).toBe(6 * 1_024 * 1_024);
    if (fetchDetectors === undefined) return;
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(fixture));

    await expect(
      fetchDetectors({ fetcher, now: generatedAt, serviceKey, signal: new AbortController().signal }),
    ).resolves.toEqual({
      detectors: [
        {
          detectorId: 'VDS-001',
          linkedRoadSegmentIds: ['1001', '1002'],
          observations: [
            [1, '20260807120000', 72.5, 18, 121],
            [0, '20260807120100', null, null, null],
          ],
        },
        {
          detectorId: 'VDS-002',
          linkedRoadSegmentIds: ['2001'],
          observations: [[2, '20260807120100', 48, 31, 17.5]],
        },
      ],
      generatedAt,
      occupancyUnit: 'provider-unspecified',
      sourceTimeBasis: 'provider-local-unspecified',
      speedUnit: 'provider-unspecified',
      volumeUnit: 'provider-unspecified',
    });

    const [requestUrl, requestInit] = fetcher.mock.calls[0] ?? [];
    expect(requestUrl).toBeInstanceOf(URL);
    const url = requestUrl as URL;
    expect(url.origin).toBe('https://openapi.its.go.kr:9443');
    expect(url.pathname).toBe('/vdsInfo');
    expect(Object.fromEntries(url.searchParams)).toEqual({ apiKey: serviceKey, getType: 'json' });
    expect(requestInit).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('accepts singleton and atomic empty forms while preserving revision timestamps', async () => {
    const fetchDetectors = getFetcher();
    expect(fetchDetectors).toBeTypeOf('function');
    if (fetchDetectors === undefined) return;
    const singleton = cloneFixture();
    singleton.body.items = singleton.body.items[0] as unknown as Record<string, unknown>[];
    singleton.body.totalCount = '1';
    await expect(
      fetchDetectors({
        fetcher: async () => jsonResponse(singleton),
        now: generatedAt,
        serviceKey,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ detectors: [{ observations: [[2, '20260807120100', 48, 31, 17.5]] }] });

    const empty = cloneFixture();
    empty.body.items = [];
    empty.body.totalCount = '0';
    await expect(
      fetchDetectors({
        fetcher: async () => jsonResponse(empty),
        now: generatedAt,
        serviceKey,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ detectors: [] });
  });

  it('deduplicates an exact repeated observation but rejects a conflicting duplicate identity', async () => {
    const fetchDetectors = getFetcher();
    expect(fetchDetectors).toBeTypeOf('function');
    if (fetchDetectors === undefined) return;
    const exact = cloneFixture();
    const repeated = structuredClone(exact.body.items[1]);
    expect(repeated).toBeDefined();
    if (repeated === undefined) return;
    exact.body.items.push(repeated);
    exact.body.totalCount = String(exact.body.items.length);
    const normalized = (await fetchDetectors({
      fetcher: async () => jsonResponse(exact),
      now: generatedAt,
      serviceKey,
      signal: new AbortController().signal,
    })) as { detectors: Array<{ detectorId: string; observations: unknown[] }> };
    expect(normalized.detectors.find(({ detectorId }) => detectorId === 'VDS-001')?.observations).toHaveLength(2);

    const conflicting = cloneFixture();
    const conflict = structuredClone(conflicting.body.items[1]);
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    conflict.speed = '71';
    conflicting.body.items.push(conflict);
    conflicting.body.totalCount = String(conflicting.body.items.length);
    await expect(
      fetchDetectors({
        fetcher: async () => jsonResponse(conflicting),
        now: generatedAt,
        serviceKey,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('ITS road traffic detector observation revisions conflict');
  });

  it('preserves provider-reported fractional negative occupancy without inventing a percentage scale', async () => {
    const fetchDetectors = getFetcher();
    expect(fetchDetectors).toBeTypeOf('function');
    if (fetchDetectors === undefined) return;
    const input = cloneFixture();
    updateFirstRow(input, 'occupancy', '-0.5');
    const result = (await fetchDetectors({
      fetcher: async () => jsonResponse(input),
      now: generatedAt,
      serviceKey,
      signal: new AbortController().signal,
    })) as { detectors: Array<{ detectorId: string; observations: unknown[][] }> };
    expect(result.detectors.find(({ detectorId }) => detectorId === 'VDS-002')?.observations[0]?.[4]).toBe(-0.5);
  });

  it('rejects malformed rows, cardinality and unsupported guesses', async () => {
    const fetchDetectors = getFetcher();
    expect(fetchDetectors).toBeTypeOf('function');
    if (fetchDetectors === undefined) return;
    const cases: Array<(input: ReturnType<typeof cloneFixture>) => void> = [
      (input) => (input.body.totalCount = '4'),
      (input) => updateFirstRow(input, 'laneNo', '33'),
      (input) => updateFirstRow(input, 'laneNo', '-0'),
      (input) => updateFirstRow(input, 'laneNo', '00'),
      (input) => updateFirstRow(input, 'colctedDate', '20260230120000'),
      (input) => updateFirstRow(input, 'speed', '-2'),
      (input) => updateFirstRow(input, 'volume', '-2'),
      (input) => updateFirstRow(input, 'occupancy', '-2'),
      (input) => updateFirstRow(input, 'linkIds', '2001,2001'),
      (input) => updateFirstRow(input, 'linkIds', ' 2001'),
      (input) => updateFirstRow(input, 'unit', 'percent'),
    ];
    for (const mutate of cases) {
      const input = cloneFixture();
      mutate(input);
      await expect(
        fetchDetectors({
          fetcher: async () => jsonResponse(input),
          now: generatedAt,
          serviceKey,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrowError(/ITS road traffic detector/u);
    }
  });

  it('fails closed on status, redirect, MIME, encoding, raw size and credential reflection', async () => {
    const fetchDetectors = getFetcher();
    expect(fetchDetectors).toBeTypeOf('function');
    if (fetchDetectors === undefined) return;
    const base = { now: generatedAt, serviceKey, signal: new AbortController().signal } as const;

    await expect(fetchDetectors({ ...base, fetcher: async () => jsonResponse({}, { status: 206 }) })).rejects.toThrow();
    await expect(
      fetchDetectors({
        ...base,
        fetcher: async () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
      }),
    ).rejects.toThrow();
    await expect(
      fetchDetectors({
        ...base,
        fetcher: async () => {
          const response = jsonResponse(fixture);
          Object.defineProperty(response, 'url', { value: 'https://example.invalid/vdsInfo' });
          return response;
        },
      }),
    ).rejects.toThrowError('ITS road traffic detector redirect is not allowed');
    await expect(
      fetchDetectors({
        ...base,
        fetcher: async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
      }),
    ).rejects.toThrowError('ITS road traffic detector response was not valid UTF-8');
    await expect(
      fetchDetectors({
        ...base,
        fetcher: async () => jsonResponse(fixture, { headers: { 'content-length': String(6 * 1_024 * 1_024 + 1) } }),
      }),
    ).rejects.toThrowError('ITS road traffic detector response size exceeds the allowed limit');
    await expect(
      fetchDetectors({
        ...base,
        fetcher: async () =>
          new Response(new Uint8Array(6 * 1_024 * 1_024 + 1), {
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toThrowError('ITS road traffic detector response size exceeds the allowed limit');

    await expect(
      fetchDetectors({
        ...base,
        fetcher: async (requestUrl) => {
          const response = jsonResponse(fixture);
          const changed = new URL(requestUrl as URL);
          changed.searchParams.set('unexpected', '1');
          Object.defineProperty(response, 'url', { value: changed.href });
          return response;
        },
      }),
    ).rejects.toThrowError('ITS road traffic detector redirect is not allowed');

    const reflected = cloneFixture();
    updateFirstRow(reflected, 'vdsId', serviceKey);
    await expect(fetchDetectors({ ...base, fetcher: async () => jsonResponse(reflected) })).rejects.toThrowError(
      'ITS road traffic detector response is invalid',
    );

    const escapedKey = 'S3CRET';
    const escaped = cloneFixture();
    updateFirstRow(escaped, 'vdsId', escapedKey);
    const escapedBody = JSON.stringify(escaped).replace(
      `"${escapedKey}"`,
      `"${[...escapedKey].map((character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0')}`).join('')}"`,
    );
    expect(escapedBody).not.toContain(escapedKey);
    await expect(
      fetchDetectors({
        fetcher: async () => new Response(escapedBody, { headers: { 'content-type': 'application/json' } }),
        now: generatedAt,
        serviceKey: escapedKey,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('ITS road traffic detector response is invalid');
  });

  it('does not call the provider for blank credentials or an already-aborted request', async () => {
    const fetchDetectors = getFetcher();
    expect(fetchDetectors).toBeTypeOf('function');
    if (fetchDetectors === undefined) return;
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(fixture));
    await expect(
      fetchDetectors({ fetcher, now: generatedAt, serviceKey: ' ', signal: new AbortController().signal }),
    ).rejects.toThrowError('ITS road traffic detector credential is missing');
    const controller = new AbortController();
    const reason = new DOMException('synthetic abort', 'AbortError');
    controller.abort(reason);
    await expect(fetchDetectors({ fetcher, now: generatedAt, serviceKey, signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
