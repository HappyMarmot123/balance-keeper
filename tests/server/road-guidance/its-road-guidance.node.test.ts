// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  fetchItsSafetyNotices,
  fetchItsVariableSpeedLimits,
  fetchItsVmsGuidance,
  ITS_ROAD_GUIDANCE_MAX_NORMALIZED_BYTES,
  ITS_ROAD_GUIDANCE_MAX_RAW_ROWS,
  ITS_ROAD_GUIDANCE_MAX_RESPONSE_BYTES,
} from '../../../src/server/providers/its/roadGuidance';

const vmsFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-guidance-vms-success.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const safetyFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-guidance-safety-success.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const vslFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/its/road-guidance-vsl-success.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const now = Date.parse('2026-08-03T12:20:00+09:00');
const serviceKey = 'synthetic-its-secret';
const clone = <Value>(input: Value): Value => structuredClone(input);
const jsonResponse = (input: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(input), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
const options = (fetcher: typeof fetch, key = serviceKey) => ({
  fetcher,
  now,
  serviceKey: key,
  signal: new AbortController().signal,
});

const directBody = (input: Record<string, unknown>): Record<string, unknown> => input.body as Record<string, unknown>;
const nestedResponse = (input: Record<string, unknown>): Record<string, unknown> =>
  input.response as Record<string, unknown>;
const nestedBody = (input: Record<string, unknown>): Record<string, unknown> =>
  nestedResponse(input).body as Record<string, unknown>;
const directRows = (input: Record<string, unknown>): Record<string, unknown>[] =>
  directBody(input).items as Record<string, unknown>[];
const nestedRows = (input: Record<string, unknown>): Record<string, unknown>[] =>
  (nestedBody(input).items as Record<string, unknown>).item as Record<string, unknown>[];
const requiredRow = (rows: readonly Record<string, unknown>[], index: number): Record<string, unknown> => {
  const row = rows.at(index);
  expect(row).toBeDefined();
  if (row === undefined) {
    throw new Error('Synthetic road guidance fixture row is missing');
  }
  return row;
};
const idsAreSorted = (items: readonly Record<string, unknown>[]): boolean => {
  const ids = items.map(({ id }) => String(id));
  return ids.every((id, index) => index === 0 || String(ids[index - 1]) < id);
};

describe('ITS road guidance provider', () => {
  it('groups VMS pages, normalizes both unambiguous Korea axes and preserves provider-local timestamp text', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(vmsFixture));
    const snapshot = await fetchItsVmsGuidance(options(fetcher));

    expect(snapshot).toMatchObject({ channel: 'vms', generatedAt: now });
    expect(snapshot.items).toHaveLength(2);
    expect(idsAreSorted(snapshot.items)).toBe(true);
    expect(snapshot.items.every(({ id }) => /^its-road-guidance:vms:[A-Za-z0-9_-]{32}$/u.test(String(id)))).toBe(true);
    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pages: [
            { lines: ['첫 줄', '둘째 줄'], order: 1 },
            { lines: ['교통 정체', '우회 안내'], order: 2 },
          ],
          position: [127.01, 37.51],
          sourceTimestamp: '20260803121600',
          timeBasis: 'provider-local-unspecified',
        }),
        expect.objectContaining({
          pages: [{ lines: [], order: 1 }],
          position: [127.02, 37.52],
          sourceTimestamp: '20260803121400',
          timeBasis: 'provider-local-unspecified',
        }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain('VMS-SYNTHETIC');

    const [requestUrl, requestInit] = fetcher.mock.calls[0] ?? [];
    expect((requestUrl as URL).href).toContain('https://openapi.its.go.kr:9443/vmsInfo?');
    expect(Object.fromEntries((requestUrl as URL).searchParams)).toEqual({
      apiKey: serviceKey,
      getType: 'json',
    });
    expect(requestInit).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  });

  it('removes safety receiver metadata, collapses recipient expansion and derives identities for blank occurrence ids', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(safetyFixture));
    const snapshot = await fetchItsSafetyNotices(options(fetcher));

    expect(snapshot).toMatchObject({ channel: 'safety-notices', generatedAt: now });
    expect(snapshot.items).toHaveLength(3);
    expect(idsAreSorted(snapshot.items)).toBe(true);
    expect(
      snapshot.items.every(({ id }) => /^its-road-guidance:safety-notice:[A-Za-z0-9_-]{32}$/u.test(String(id))),
    ).toBe(true);
    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: '전방 합성 차로 차단',
          position: [127.01, 37.51],
          providerPriorityCode: 2,
          providerStepCode: 1,
          providerType: '차로차단',
        }),
        expect.objectContaining({
          message: '속도를 줄이세요',
          position: [127.01, 37.51],
          providerPriorityCode: 1,
          providerStepCode: 2,
          providerType: '차로차단',
        }),
        expect.objectContaining({
          message: '합성 위험 구간',
          position: [126.99, 37.49],
          providerPriorityCode: 3,
          providerStepCode: 0,
          providerType: '주의운전',
        }),
      ]),
    );
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('SYNTHETIC-OCCURRENCE');
    expect(serialized).not.toContain('RECEIVER-');
    expect(serialized).not.toContain('수신선');

    const requestUrl = fetcher.mock.calls[0]?.[0] as URL;
    expect((requestUrl as URL).href).toContain('https://openapi.its.go.kr:9443/posIncidentInfo?');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      apiKey: serviceKey,
      getType: 'json',
      maxX: '132',
      maxY: '40',
      minX: '124',
      minY: '32',
    });
  });

  it('normalizes VSL per row, keeps provider-unspecified semantics and permits reversed source timestamps and higher limits', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(vslFixture));
    const snapshot = await fetchItsVariableSpeedLimits(options(fetcher));

    expect(snapshot).toMatchObject({ channel: 'variable-speed-limits', generatedAt: now });
    expect(snapshot.items).toHaveLength(2);
    expect(idsAreSorted(snapshot.items)).toBe(true);
    expect(snapshot.items.every(({ id }) => /^its-road-guidance:vsl:[A-Za-z0-9_-]{32}$/u.test(String(id)))).toBe(true);
    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultLimitSpeed: 100,
          limitSpeed: 80,
          linkId: null,
          position: [127.01, 37.51],
          restrictionState: 'provider-unspecified',
          roadClass: 'expressway',
          roadNumber: '1',
          sourceCreatedTimestamp: '20260803121600',
          sourceRegisteredTimestamp: '20260803121700',
          speedUnit: 'provider-unspecified',
          timeBasis: 'provider-local-unspecified',
        }),
        expect.objectContaining({
          defaultLimitSpeed: 100,
          limitSpeed: 110,
          linkId: 'SYNTHETIC-VSL-LINK',
          position: [127.02, 37.52],
          roadClass: 'national-road',
          sourceCreatedTimestamp: '20260803121900',
          sourceRegisteredTimestamp: '20260803121800',
        }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain('VSL-SYNTHETIC');

    const requestUrl = fetcher.mock.calls[0]?.[0] as URL;
    expect((requestUrl as URL).href).toContain('https://openapi.its.go.kr:9443/vslInfo?');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({ apiKey: serviceKey, getType: 'json' });
  });

  it('validates every VSL row instead of freezing the first fifty rows axis', async () => {
    const input = clone(vslFixture);
    const base = directRows(input)[0] as Record<string, unknown>;
    const rows = Array.from({ length: 51 }, (_, index) => ({
      ...clone(base),
      coordX: index < 50 ? '37.51' : '127.01',
      coordY: index < 50 ? '127.01' : '37.51',
      vslId: `VSL-MIXED-${index}`,
    }));
    directBody(input).items = rows;
    directBody(input).totalCount = rows.length;

    await expect(fetchItsVariableSpeedLimits(options(async () => jsonResponse(input)))).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ position: [127.01, 37.51] })]),
    });
  });

  it('accepts strict direct and nested response envelopes with singleton and explicit empty item shapes', async () => {
    const services = [
      [fetchItsVmsGuidance, vmsFixture, 'vms'],
      [fetchItsSafetyNotices, safetyFixture, 'safety-notices'],
      [fetchItsVariableSpeedLimits, vslFixture, 'variable-speed-limits'],
    ] as const;

    for (const [fetchGuidance, source, channel] of services) {
      const sourceBody = channel === 'safety-notices' ? nestedBody(clone(source)) : directBody(clone(source));
      const rawItems = sourceBody.items as unknown;
      const rows = Array.isArray(rawItems)
        ? rawItems
        : ((rawItems as Record<string, unknown>).item as Record<string, unknown>[]);
      const singletonRow =
        channel === 'vms' ? rows.find((row) => (row as Record<string, unknown>).messageNo === '1') : rows[0];
      expect(singletonRow).toBeDefined();
      const first = clone(singletonRow as Record<string, unknown>);
      const singleton = {
        header: { resultCode: '0', resultMsg: 'SUCCESS' },
        body: { items: { item: first }, totalCount: '1' },
      };
      await expect(fetchGuidance(options(async () => jsonResponse(singleton)))).resolves.toMatchObject({
        channel,
        items: [expect.any(Object)],
      });

      const empty = {
        response: {
          header: { resultCode: 0, resultMsg: 'SUCCESS' },
          body: { items: {}, totalCount: 0 },
        },
      };
      await expect(fetchGuidance(options(async () => jsonResponse(empty)))).resolves.toMatchObject({
        channel,
        items: [],
      });
    }
  });

  it('deduplicates exact VMS/VSL identities and rejects conflicting identities', async () => {
    const vmsConflict = clone(vmsFixture);
    requiredRow(directRows(vmsConflict), -1).message = '충돌 문안|';
    await expect(fetchItsVmsGuidance(options(async () => jsonResponse(vmsConflict)))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );

    const vslConflict = clone(vslFixture);
    requiredRow(directRows(vslConflict), -1).limitSpeed = '90';
    await expect(fetchItsVariableSpeedLimits(options(async () => jsonResponse(vslConflict)))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );
  });

  it.each([
    ['page gap', 'messageNo', '3'],
    ['non-canonical page', 'messageNo', ' 1'],
    ['invalid calendar', 'createdDate', '20260230120000'],
    ['out-of-country coordinate', 'coordX', '140'],
    ['markup', 'message', '<script>unsafe</script>|'],
    ['C0 control', 'message', 'unsafe\u0007|'],
    ['C1 control', 'message', 'unsafe\u0085|'],
    ['DEL control', 'message', 'unsafe\u007f|'],
    ['bidi control', 'message', 'unsafe\u202e|'],
    ['unknown field', 'unsafeField', 'unsafe'],
  ])('rejects invalid VMS %s', async (_label, field, value) => {
    const input = clone(vmsFixture);
    requiredRow(directRows(input), 0)[field] = value;
    await expect(fetchItsVmsGuidance(options(async () => jsonResponse(input)))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );
  });

  it('rejects VMS position conflicts inside one sign', async () => {
    const input = clone(vmsFixture);
    requiredRow(directRows(input), 2).coordX = '127.03';
    await expect(fetchItsVmsGuidance(options(async () => jsonResponse(input)))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );
  });

  it('rejects conflicting timestamps for the same VMS page order', async () => {
    const input = clone(vmsFixture);
    requiredRow(directRows(input), -1).createdDate = '20260803121700';
    await expect(fetchItsVmsGuidance(options(async () => jsonResponse(input)))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );
  });

  it.each([
    ['swapped documented start axis', 'startX', '37.51'],
    ['blank message', 'message', '   '],
    ['blank type', 'outbrkType', ''],
    ['invalid step code', 'stepType', 'A'],
    ['invalid priority code', 'priority', '-1'],
    ['markup', 'message', '<b>unsafe</b>'],
    ['control', 'message', 'unsafe\u202e'],
    ['unknown field', 'unsafeField', 'unsafe'],
  ])('rejects invalid safety notice %s', async (_label, field, value) => {
    const input = clone(safetyFixture);
    requiredRow(nestedRows(input), 0)[field] = value;
    await expect(fetchItsSafetyNotices(options(async () => jsonResponse(input)))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );
  });

  it.each([
    ['unknown section code', 'sectionCode', '3'],
    ['negative speed', 'limitSpeed', '-1'],
    ['speed over bound', 'defLmtSpeed', '301'],
    ['invalid calendar', 'registedDate', '20260230120000'],
    ['invalid coordinate', 'coordX', '80'],
    ['removed cancellation field', 'cntcedDate', '20260803122000'],
  ])('rejects invalid VSL %s', async (_label, field, value) => {
    const input = clone(vslFixture);
    requiredRow(directRows(input), 0)[field] = value;
    await expect(fetchItsVariableSpeedLimits(options(async () => jsonResponse(input)))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );
  });

  it('fails closed for transport metadata, malformed payloads, invalid UTF-8 and bounded overflow', async () => {
    expect(ITS_ROAD_GUIDANCE_MAX_RESPONSE_BYTES).toBe(2 * 1024 * 1024);
    expect(ITS_ROAD_GUIDANCE_MAX_NORMALIZED_BYTES).toBe(2 * 1024 * 1024);
    expect(ITS_ROAD_GUIDANCE_MAX_RAW_ROWS).toBe(5_000);

    const base = options(async () => jsonResponse(vmsFixture));
    await expect(
      fetchItsVmsGuidance({ ...base, fetcher: async () => jsonResponse({}, { status: 206 }) }),
    ).rejects.toThrow();
    await expect(
      fetchItsVmsGuidance({
        ...base,
        fetcher: async () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
      }),
    ).rejects.toThrow();
    await expect(
      fetchItsVmsGuidance({
        ...base,
        fetcher: async () => {
          const response = jsonResponse(vmsFixture);
          Object.defineProperty(response, 'url', { value: 'http://openapi.its.go.kr:9443/vmsInfo' });
          return response;
        },
      }),
    ).rejects.toThrow();
    await expect(
      fetchItsVmsGuidance({
        ...base,
        fetcher: async () => new Response('{', { headers: { 'content-type': 'application/json' } }),
      }),
    ).rejects.toThrowError('ITS road guidance response was not valid JSON');
    await expect(
      fetchItsVmsGuidance({
        ...base,
        fetcher: async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
      }),
    ).rejects.toThrowError('ITS road guidance response was not valid UTF-8');
    await expect(
      fetchItsVmsGuidance({
        ...base,
        fetcher: async () =>
          new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toThrowError('ITS road guidance response size exceeds the allowed limit');
  });

  it('honors abort without wrapping the abort reason', async () => {
    const controller = new AbortController();
    const reason = new DOMException('stop', 'AbortError');
    controller.abort(reason);

    await expect(
      fetchItsVmsGuidance({ ...options(async () => jsonResponse(vmsFixture)), signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it('rejects provider failure, count mismatch, row overflow and credential reflection without leaking details', async () => {
    const failed = clone(vmsFixture);
    (failed.header as Record<string, unknown>).resultCode = '1';
    (failed.header as Record<string, unknown>).resultMsg = 'unsafe account detail';
    await expect(fetchItsVmsGuidance(options(async () => jsonResponse(failed)))).rejects.toThrowError(
      'ITS road guidance provider returned a non-success result',
    );

    const mismatch = clone(vmsFixture);
    directBody(mismatch).totalCount = 999;
    await expect(fetchItsVmsGuidance(options(async () => jsonResponse(mismatch)))).rejects.toThrowError(
      'ITS road guidance response count is inconsistent',
    );

    const overflow = clone(vslFixture);
    const row = directRows(overflow)[0] as Record<string, unknown>;
    directBody(overflow).items = Array.from({ length: 5_001 }, (_, index) => ({
      ...clone(row),
      vslId: `VSL-OVERFLOW-${index}`,
    }));
    directBody(overflow).totalCount = 5_001;
    await expect(fetchItsVariableSpeedLimits(options(async () => jsonResponse(overflow)))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );

    const reflected = clone(vmsFixture);
    requiredRow(directRows(reflected), 0).message = 'S3CRET|';
    const escapedKey = [...'S3CRET']
      .map((character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0')}`)
      .join('');
    const escapedBody = JSON.stringify(reflected).replace('S3CRET', escapedKey);
    await expect(fetchItsVmsGuidance(options(async () => jsonResponse(reflected), 'S3CRET'))).rejects.toThrowError(
      'ITS road guidance response is invalid',
    );
    await expect(
      fetchItsVmsGuidance({
        ...options(async () => jsonResponse(reflected), 'S3CRET'),
        fetcher: async () => new Response(escapedBody, { headers: { 'content-type': 'application/json' } }),
      }),
    ).rejects.toThrowError('ITS road guidance response is invalid');

    const jsonEscapedCredential = 'A"B\\C';
    const speciallyEscapedReflection = clone(vmsFixture);
    requiredRow(directRows(speciallyEscapedReflection), 0).message = jsonEscapedCredential;
    await expect(
      fetchItsVmsGuidance({
        ...options(async () => jsonResponse(speciallyEscapedReflection), jsonEscapedCredential),
      }),
    ).rejects.toThrowError('ITS road guidance response is invalid');
  });
});
