// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import * as itsProviderModule from '../../../src/server/providers/its';

const provider = itsProviderModule as Readonly<Record<string, unknown>>;
const incidentFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-events-incidents-success.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const disasterFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-events-disasters-success.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const now = Date.parse('2026-08-03T15:20:00+09:00');

type FetchRoadEvents = (
  options: Readonly<{
    fetcher: typeof fetch;
    now: number;
    serviceKey: string;
    signal: AbortSignal;
  }>,
) => Promise<{
  channel: string;
  events: readonly Record<string, unknown>[];
  generatedAt: number;
}>;

const getFetcher = (name: 'fetchItsRoadDisasters' | 'fetchItsRoadIncidents'): FetchRoadEvents | undefined =>
  provider[name] as FetchRoadEvents | undefined;
const clone = <Value>(input: Value): Value => structuredClone(input);
const jsonResponse = (input: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(input), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
const incidentRows = (input: Record<string, unknown>): Record<string, unknown>[] =>
  input.data as Record<string, unknown>[];
const disasterEnvelope = (input: Record<string, unknown>) => input.response as Record<string, unknown>;
const disasterBody = (input: Record<string, unknown>) => disasterEnvelope(input).body as Record<string, unknown>;
const disasterRows = (input: Record<string, unknown>): Record<string, unknown>[] =>
  (disasterBody(input).items as Record<string, unknown>).item as Record<string, unknown>[];
const options = (fetcher: typeof fetch) => ({
  fetcher,
  now,
  serviceKey: 'synthetic-its-secret',
  signal: new AbortController().signal,
});

describe('ITS road events provider', () => {
  it('requests nationwide incidents and normalizes active, scheduled and expired lifecycle without exposing raw ids', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;

    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(incidentFixture));
    const snapshot = await fetchIncidents(options(fetcher));

    expect(snapshot).toMatchObject({ channel: 'incidents', generatedAt: now });
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        category: 'other',
        endsAt: null,
        geometry: { kind: 'point', position: [126.98, 37.55] },
        lifecycle: 'scheduled',
        message: null,
        severity: 'provider-unspecified',
        startsAt: Date.parse('2026-08-03T16:00:00+09:00'),
      }),
      expect.objectContaining({
        category: 'roadwork',
        endsAt: Date.parse('2026-08-03T18:00:00+09:00'),
        geometry: { kind: 'point', position: [127.01, 37.51] },
        lifecycle: 'active',
        message: '합성 도로 공사',
        severity: 'provider-unspecified',
        startsAt: Date.parse('2026-08-03T10:00:00+09:00'),
      }),
    ]);
    expect(snapshot.events.every(({ id }) => /^its-road-event:[A-Za-z0-9_-]{32}$/u.test(String(id)))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('LINK-');

    const [requestUrl, requestInit] = fetcher.mock.calls[0] ?? [];
    expect(Object.fromEntries((requestUrl as URL).searchParams)).toEqual({
      apiKey: 'synthetic-its-secret',
      eventType: 'all',
      getType: 'json',
      maxX: '132',
      maxY: '40',
      minX: '124',
      minY: '32',
      type: 'all',
    });
    expect((requestUrl as URL).href).toContain('https://openapi.its.go.kr:9443/eventInfo?');
    expect(requestInit).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  });

  it('requests the inclusive seven-day KST disaster window and normalizes bare point, line and area coordinates', async () => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;

    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(disasterFixture));
    const snapshot = await fetchDisasters(options(fetcher));

    expect(snapshot).toMatchObject({ channel: 'disasters', generatedAt: now });
    expect(snapshot.events.map(({ category, geometry }) => ({ category, geometry }))).toEqual([
      {
        category: 'river-flood',
        geometry: {
          kind: 'line',
          path: [
            [127.01, 37.51],
            [127.02, 37.52],
          ],
        },
      },
      {
        category: 'wildfire',
        geometry: {
          kind: 'area',
          ring: [
            [127, 37.5],
            [127.1, 37.5],
            [127.05, 37.6],
          ],
        },
      },
      { category: 'flooding', geometry: { kind: 'point', position: [127.02, 37.52] } },
    ]);
    const requestUrl = fetcher.mock.calls[0]?.[0] as URL;
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      apiKey: 'synthetic-its-secret',
      category: 'D',
      endDate: '20260803',
      eventType: 'all',
      getType: 'json',
      maxX: '132',
      maxY: '40',
      minX: '124',
      minY: '32',
      startDate: '20260728',
    });
  });

  it('accepts the official disaster sample nullability and omitted unused road fields', async () => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;
    const input = clone(disasterFixture);
    const row = disasterRows(input)[0] as Record<string, unknown>;
    row.status = null;
    row.socExtent = null;
    row.lanesBlocked = null;
    delete row.roadNo;
    delete row.roadDrcType;
    delete row.locationGeometry;

    await expect(fetchDisasters(options(async () => jsonResponse(input)))).resolves.toMatchObject({
      channel: 'disasters',
      events: [expect.any(Object), expect.any(Object), expect.any(Object)],
    });
  });

  it.each([
    ['D03', '해제'],
    ['D03', '대치해제'],
    ['D03', '변경해제'],
    ['D06', '3'],
    ['D07', '2'],
    ['D07', '3'],
  ])('excludes documented terminal disaster %s status %s without an end date', async (eventType, status) => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;
    const input = clone(disasterFixture);
    const row = disasterRows(input)[0] as Record<string, unknown>;
    row.eventType = eventType;
    row.status = status;
    row.endDate = null;
    disasterBody(input).totalCount = '1';
    (disasterBody(input).items as Record<string, unknown>).item = row;

    await expect(fetchDisasters(options(async () => jsonResponse(input)))).resolves.toMatchObject({
      channel: 'disasters',
      events: [],
    });
  });

  it('accepts singleton/object and explicit empty provider envelopes with exact cardinality', async () => {
    for (const [name, base, selectRows] of [
      ['fetchItsRoadIncidents', incidentFixture, incidentRows],
      ['fetchItsRoadDisasters', disasterFixture, disasterRows],
    ] as const) {
      const fetchEvents = getFetcher(name);
      expect(fetchEvents).toBeTypeOf('function');
      if (fetchEvents === undefined) continue;
      const singleton = clone(base);
      const first = selectRows(singleton)[0];
      expect(first).toBeDefined();
      if (first === undefined) continue;
      if (name === 'fetchItsRoadIncidents') {
        singleton.totalCount = 1;
        singleton.data = first;
      } else {
        disasterBody(singleton).totalCount = '1';
        (disasterBody(singleton).items as Record<string, unknown>).item = first;
      }
      await expect(fetchEvents(options(async () => jsonResponse(singleton)))).resolves.toMatchObject({
        events: [expect.any(Object)],
      });

      const empty =
        name === 'fetchItsRoadIncidents'
          ? { resultCode: '0', resultMsg: 'SUCCESS', totalCount: 0, data: [] }
          : { header: { resultCode: '0', resultMsg: 'SUCCESS' }, body: { totalCount: '0', items: {} } };
      await expect(fetchEvents(options(async () => jsonResponse(empty)))).resolves.toMatchObject({ events: [] });
    }
  });

  it('accepts the observed response.data envelope only when its count is exact', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;
    const first = incidentRows(incidentFixture)[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const responseData = {
      response: {
        body: { totalCount: '1' },
        data: first,
        header: { resultCode: '0', resultMsg: 'SUCCESS' },
      },
    };

    await expect(fetchIncidents(options(async () => jsonResponse(responseData)))).resolves.toMatchObject({
      events: [expect.objectContaining({ category: 'roadwork' })],
    });
  });

  it('deduplicates exact identities deterministically and rejects conflicting identities', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchIncidents).toBeTypeOf('function');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchIncidents === undefined || fetchDisasters === undefined) return;

    const duplicate = clone(incidentFixture);
    incidentRows(duplicate).push(clone(incidentRows(duplicate)[0] as Record<string, unknown>));
    duplicate.totalCount = incidentRows(duplicate).length;
    const first = await fetchIncidents(options(async () => jsonResponse(duplicate)));
    const second = await fetchIncidents(options(async () => jsonResponse(duplicate)));
    expect(first).toEqual(second);
    expect(first.events).toHaveLength(2);

    const conflict = clone(disasterFixture);
    const conflictingRow = clone(disasterRows(conflict)[0] as Record<string, unknown>);
    conflictingRow.message = '다른 합성 메시지';
    disasterRows(conflict).push(conflictingRow);
    disasterBody(conflict).totalCount = disasterRows(conflict).length;
    await expect(fetchDisasters(options(async () => jsonResponse(conflict)))).rejects.toThrowError(/ITS road events/u);
  });

  it('keeps an incident id stable when mutable provider fields change between snapshots', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;
    const revised = clone(incidentFixture);
    const revisedRow = incidentRows(revised)[0] as Record<string, unknown>;
    revisedRow.message = '수정된 합성 도로 공사';
    revisedRow.endDate = '20260803190000';
    revisedRow.lanesBlocked = '2';

    const before = await fetchIncidents(options(async () => jsonResponse(incidentFixture)));
    const after = await fetchIncidents(options(async () => jsonResponse(revised)));
    const occurrenceStart = Date.parse('2026-08-03T10:00:00+09:00');

    expect(before.events.find(({ startsAt }) => startsAt === occurrenceStart)?.id).toBe(
      after.events.find(({ startsAt }) => startsAt === occurrenceStart)?.id,
    );
  });

  it('collapses simultaneous incident revisions without guessing conflicting mutable details', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;
    const input = clone(incidentFixture);
    const conflictingRevision = clone(incidentRows(input)[0] as Record<string, unknown>);
    conflictingRevision.message = '동일 사건 키의 충돌 리비전';
    conflictingRevision.endDate = '20260803190000';
    conflictingRevision.lanesBlocked = '2';
    incidentRows(input).push(conflictingRevision);
    input.totalCount = String(incidentRows(input).length);

    const forward = await fetchIncidents(options(async () => jsonResponse(input)));
    incidentRows(input).reverse();
    const reversed = await fetchIncidents(options(async () => jsonResponse(input)));
    const occurrenceStart = Date.parse('2026-08-03T10:00:00+09:00');
    const event = forward.events.find(({ startsAt }) => startsAt === occurrenceStart);

    expect(event).toMatchObject({ endsAt: null, lifecycle: 'unknown', message: null });
    expect(reversed).toEqual(forward);
  });

  it('does not discard an ended incident revision before resolving a conflicting active revision', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;
    const input = clone(incidentFixture);
    const endedRevision = clone(incidentRows(input)[0] as Record<string, unknown>);
    endedRevision.endDate = '20260803150000';
    incidentRows(input).push(endedRevision);
    input.totalCount = String(incidentRows(input).length);

    const result = await fetchIncidents(options(async () => jsonResponse(input)));
    const occurrenceStart = Date.parse('2026-08-03T10:00:00+09:00');

    expect(result.events.find(({ startsAt }) => startsAt === occurrenceStart)).toMatchObject({
      endsAt: null,
      lifecycle: 'unknown',
    });
  });

  it('discards an incident when every conflicting revision has already ended', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;
    const input = clone(incidentFixture);
    const row = incidentRows(input)[0] as Record<string, unknown>;
    row.endDate = '20260803140000';
    const laterEndedRevision = clone(row);
    laterEndedRevision.endDate = '20260803150000';
    incidentRows(input).push(laterEndedRevision);
    input.totalCount = String(incidentRows(input).length);

    const result = await fetchIncidents(options(async () => jsonResponse(input)));
    const occurrenceStart = Date.parse('2026-08-03T10:00:00+09:00');

    expect(result.events.find(({ startsAt }) => startsAt === occurrenceStart)).toBeUndefined();
  });

  it.each([
    {
      label: 'message-only conflict',
      mutate: (row: Record<string, unknown>) => {
        row.message = '수정된 합성 메시지';
      },
      rowIndex: 0,
      expected: {
        endsAt: Date.parse('2026-08-03T18:00:00+09:00'),
        lifecycle: 'active',
        message: null,
      },
    },
    {
      label: 'end-only conflict',
      mutate: (row: Record<string, unknown>) => {
        row.endDate = '20260803190000';
      },
      rowIndex: 0,
      expected: { endsAt: null, lifecycle: 'unknown', message: '합성 도로 공사' },
    },
    {
      label: 'future scheduled conflict',
      mutate: (row: Record<string, unknown>) => {
        row.endDate = '20260803170000';
      },
      rowIndex: 1,
      expected: { endsAt: null, lifecycle: 'scheduled', message: null },
    },
  ])('merges an incident $label conservatively', async ({ expected, mutate, rowIndex }) => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;
    const input = clone(incidentFixture);
    const original = incidentRows(input)[rowIndex] as Record<string, unknown>;
    const revision = clone(original);
    mutate(revision);
    incidentRows(input).push(revision);
    input.totalCount = String(incidentRows(input).length);

    const result = await fetchIncidents(options(async () => jsonResponse(input)));
    const startsAt = Date.parse(rowIndex === 0 ? '2026-08-03T10:00:00+09:00' : '2026-08-03T16:00:00+09:00');

    expect(result.events.find((event) => event.startsAt === startsAt)).toMatchObject(expected);
  });

  it('merges three incident revisions independently of provider row order', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;
    const base = clone(incidentRows(incidentFixture)[0] as Record<string, unknown>);
    const revisionA = clone(base);
    revisionA.endDate = '20260803190000';
    const revisionB = clone(base);
    revisionB.message = '두 번째 합성 메시지';
    revisionB.endDate = '20260803200000';
    const permutations = [
      [base, revisionA, revisionB],
      [base, revisionB, revisionA],
      [revisionA, base, revisionB],
      [revisionA, revisionB, base],
      [revisionB, base, revisionA],
      [revisionB, revisionA, base],
    ];

    const snapshots = await Promise.all(
      permutations.map(async (revisions) => {
        const input = clone(incidentFixture);
        input.data = [...revisions.map((row) => clone(row)), ...incidentRows(input).slice(1)];
        input.totalCount = String(incidentRows(input).length);
        return fetchIncidents(options(async () => jsonResponse(input)));
      }),
    );

    expect(snapshots.every((snapshot) => JSON.stringify(snapshot) === JSON.stringify(snapshots[0]))).toBe(true);
  });

  it.each([
    ['invalid KST calendar', 'startDate', '20260230010101'],
    ['out-of-country incident point', 'coordX', '140'],
    ['unknown provider row field', 'unsafeField', 'unsafe'],
  ])('rejects incident %s', async (_label, field, value) => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;
    const input = clone(incidentFixture);
    (incidentRows(input)[0] as Record<string, unknown>)[field] = value;
    await expect(fetchIncidents(options(async () => jsonResponse(input)))).rejects.toThrowError(/ITS road events/u);
  });

  it('accepts a bounded disaster line whose official geometry text exceeds a generic provider field', async () => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;
    const input = clone(disasterFixture);
    const row = disasterRows(input)[0] as Record<string, unknown>;
    const positions = Array.from({ length: 120 }, (_, index) => `${127 + index / 10_000} ${37 + index / 10_000}`);
    row.locationInfoType = '2';
    row.locationInfo = positions.join(', ');

    const result = await fetchDisasters(options(async () => jsonResponse(input)));
    const line = result.events
      .map(({ geometry }) => geometry as { kind?: string; path?: readonly unknown[] })
      .find(({ kind, path }) => kind === 'line' && path?.length === 120);

    expect((row.locationInfo as string).length).toBeGreaterThan(2_000);
    expect(line?.kind).toBe('line');
    expect(line?.path).toHaveLength(120);
  });

  it('treats the observed disaster end-date hyphen sentinel as an unknown end', async () => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;
    const input = clone(disasterFixture);
    const row = disasterRows(input)[0] as Record<string, unknown>;
    row.endDate = '-';

    const result = await fetchDisasters(options(async () => jsonResponse(input)));
    const startsAt = Date.parse('2026-08-03T11:00:00+09:00');

    expect(result.events.find((event) => event.startsAt === startsAt)).toMatchObject({
      endsAt: null,
      lifecycle: 'unknown',
    });
  });

  it('accepts strict WKT polygon geometry when it matches the provider geometry type', async () => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;
    const input = clone(disasterFixture);
    const row = disasterRows(input)[0] as Record<string, unknown>;
    row.locationInfoType = '3';
    row.locationInfo = 'POLYGON ((127.00 37.50, 127.10 37.50, 127.05 37.60, 127.00 37.50))';

    const result = await fetchDisasters(options(async () => jsonResponse(input)));
    const area = result.events
      .map(({ geometry }) => geometry as { kind?: string; ring?: readonly unknown[] })
      .find(({ kind, ring }) => kind === 'area' && ring?.length === 4);

    expect(area?.kind).toBe('area');
    expect(area?.ring?.[0]).toEqual(area?.ring?.at(-1));
  });

  it('rejects an unclosed WKT polygon ring', async () => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;
    const input = clone(disasterFixture);
    const row = disasterRows(input)[0] as Record<string, unknown>;
    row.locationInfoType = '3';
    row.locationInfo = 'POLYGON ((127.00 37.50, 127.10 37.50, 127.05 37.60))';

    await expect(fetchDisasters(options(async () => jsonResponse(input)))).rejects.toThrowError(/ITS road events/u);
  });

  it.each([
    ['mismatched WKT wrapper', 'locationInfo', 'POLYGON ((127.00 37.50, 127.10 37.50, 127.05 37.60))'],
    ['nonblank legacy geometry', 'locationGeometry', '127.02 37.52'],
    ['invalid geometry type', 'locationInfoType', 'Point'],
    ['malformed pair', 'locationInfo', '127.02'],
    ['out-of-country coordinate', 'locationInfo', '140 37.52'],
    ['invalid 12-digit end calendar', 'endDate', '202602301200'],
    ['blank disaster message', 'message', '   '],
  ])('rejects disaster %s', async (_label, field, value) => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;
    const input = clone(disasterFixture);
    (disasterRows(input)[0] as Record<string, unknown>)[field] = value;
    await expect(fetchDisasters(options(async () => jsonResponse(input)))).rejects.toThrowError(/ITS road events/u);
  });

  it('rejects conflicting geometry field casing and does not invent polygon closure', async () => {
    const fetchDisasters = getFetcher('fetchItsRoadDisasters');
    expect(fetchDisasters).toBeTypeOf('function');
    if (fetchDisasters === undefined) return;

    const conflict = clone(disasterFixture);
    const row = disasterRows(conflict)[0] as Record<string, unknown>;
    row.LocationInfoType = '2';
    row.LocationInfo = row.locationInfo;
    await expect(fetchDisasters(options(async () => jsonResponse(conflict)))).rejects.toThrowError(/ITS road events/u);

    const snapshot = await fetchDisasters(options(async () => jsonResponse(disasterFixture)));
    const area = snapshot.events.find(({ geometry }) => (geometry as { kind?: string }).kind === 'area');
    const ring = (area?.geometry as { ring?: readonly unknown[] } | undefined)?.ring;
    expect(ring).toHaveLength(3);
    expect(ring?.[0]).not.toEqual(ring?.at(-1));
  });

  it('fails closed for non-200, redirect, non-JSON MIME, malformed JSON, invalid UTF-8 and bounded overflow', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    expect(provider.ITS_ROAD_EVENTS_MAX_RESPONSE_BYTES).toBe(512 * 1024);
    if (fetchIncidents === undefined) return;

    const base = options(async () => jsonResponse(incidentFixture));
    await expect(fetchIncidents({ ...base, fetcher: async () => jsonResponse({}, { status: 206 }) })).rejects.toThrow();
    await expect(
      fetchIncidents({
        ...base,
        fetcher: async () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
      }),
    ).rejects.toThrow();
    await expect(
      fetchIncidents({
        ...base,
        fetcher: async () => {
          const response = jsonResponse(incidentFixture);
          Object.defineProperty(response, 'url', { value: 'http://openapi.its.go.kr:9443/eventInfo' });
          return response;
        },
      }),
    ).rejects.toThrow();
    await expect(
      fetchIncidents({
        ...base,
        fetcher: async () => new Response('{', { headers: { 'content-type': 'application/json' } }),
      }),
    ).rejects.toThrowError('ITS road events response was not valid JSON');
    await expect(
      fetchIncidents({
        ...base,
        fetcher: async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
      }),
    ).rejects.toThrowError('ITS road events response was not valid UTF-8');
    await expect(
      fetchIncidents({
        ...base,
        fetcher: async () =>
          new Response(new Uint8Array(512 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
      }),
    ).rejects.toThrowError('ITS road events response size exceeds the allowed limit');
  });

  it('rejects provider failure, count mismatch and raw or JSON-escaped credential reflection without leaking details', async () => {
    const fetchIncidents = getFetcher('fetchItsRoadIncidents');
    expect(fetchIncidents).toBeTypeOf('function');
    if (fetchIncidents === undefined) return;

    const failed = clone(incidentFixture);
    failed.resultCode = '1';
    failed.resultMsg = 'unsafe account detail';
    await expect(fetchIncidents(options(async () => jsonResponse(failed)))).rejects.toThrowError(
      'ITS road events provider returned a non-success result',
    );
    const mismatch = clone(incidentFixture);
    mismatch.totalCount = 99;
    await expect(fetchIncidents(options(async () => jsonResponse(mismatch)))).rejects.toThrowError(/ITS road events/u);

    const serviceKey = 'S3CRET';
    const reflected = clone(incidentFixture);
    (incidentRows(reflected)[0] as Record<string, unknown>).message = serviceKey;
    const escapedKey = [...serviceKey]
      .map((character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0')}`)
      .join('');
    const escapedBody = JSON.stringify(reflected).replace(`"${serviceKey}"`, `"${escapedKey}"`);
    await expect(fetchIncidents({ ...options(async () => jsonResponse(reflected)), serviceKey })).rejects.toThrowError(
      'ITS road events response is invalid',
    );
    await expect(
      fetchIncidents({
        ...options(async () => jsonResponse(reflected)),
        fetcher: async () => new Response(escapedBody, { headers: { 'content-type': 'application/json' } }),
        serviceKey,
      }),
    ).rejects.toThrowError('ITS road events response is invalid');
  });
});
