// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { MaritimeTrafficSnapshot } from '../../../src/entities/maritime-traffic';
import * as komsaModule from '../../../src/server/providers/komsa';

const komsa = komsaModule as Record<string, unknown>;
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/komsa/maritime-traffic-success.json'), 'utf8'),
) as Record<string, unknown>;
const cloneFixture = (): Record<string, unknown> => structuredClone(fixture);

const fixtureBody = (input: Record<string, unknown>) =>
  (
    input as {
      response: {
        body: {
          dataType: string;
          items: { item: Array<Record<string, unknown>> | Record<string, unknown> };
          numOfRows: number;
          pageNo: number;
          regDt: string;
          totalCount: number;
        };
      };
    }
  ).response.body;

const fixtureRows = (input: Record<string, unknown>): Array<Record<string, unknown>> => {
  const item = fixtureBody(input).items.item;
  return Array.isArray(item) ? item : [item];
};

type FetchSnapshot = (options: {
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}) => Promise<MaritimeTrafficSnapshot>;

describe('KOMSA maritime traffic provider', () => {
  it('imports the server-safe entity contract instead of the browser barrel', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/providers/komsa/maritimeTraffic.ts'), 'utf8');

    expect(source).toContain("from '../../../entities/maritime-traffic/contract'");
    expect(source).not.toMatch(/from ['"]\.\.\/\.\.\/\.\.\/entities\/maritime-traffic['"]/u);
  });

  it('requests one bounded HTTPS page and normalizes a deterministic level-4 snapshot', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const controller = new AbortController();
    const serviceKey = 'synthetic+komsa/key=';
    let requestedUrl: URL | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = new URL(input instanceof URL ? input.href : String(input));
      expect(init).toMatchObject({
        headers: { Accept: 'application/json' },
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      });
      return Response.json(fixture);
    });

    await expect(
      fetchSnapshot({
        fetcher,
        serviceKey,
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      cells: [
        {
          densityPercent: 43.5,
          gridId: 'G3SYNTHETIC_A1',
          vesselCount: 12,
        },
        {
          densityPercent: 18.25,
          gridId: 'G3SYNTHETIC_B2',
          vesselCount: 7,
        },
      ],
      generatedAt: Date.parse('2026-07-31T03:30:00.000Z'),
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(requestedUrl?.href).toContain('https://apis.data.go.kr/B554035/realtime/get_realtime?');
    expect(Object.fromEntries(requestedUrl?.searchParams ?? [])).toEqual({
      dataType: 'JSON',
      numOfRows: '5000',
      pageNo: '1',
      serviceKey,
    });
  });

  it('fails closed on a missing server credential before making a request', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const fetcher = vi.fn(async () => Response.json(fixture));
    await expect(
      fetchSnapshot({
        fetcher,
        serviceKey: '   ',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('KOMSA maritime traffic credential is missing');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts a data.go.kr URL-encoded credential without double encoding it', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    let requestedKey: string | null = null;
    await fetchSnapshot({
      fetcher: async (input) => {
        requestedKey = new URL(input instanceof URL ? input.href : String(input)).searchParams.get('serviceKey');
        return Response.json(fixture);
      },
      serviceKey: 'synthetic%2Bkomsa%2Fkey%3D',
      signal: new AbortController().signal,
    });

    expect(requestedKey).toBe('synthetic+komsa/key=');
  });

  it('rejects a non-success HTTP response without parsing its body', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const response = new Response('unsafe upstream detail', {
      headers: { 'content-type': 'text/plain' },
      status: 503,
    });
    const jsonSpy = vi.spyOn(response, 'json');

    await expect(
      fetchSnapshot({
        fetcher: async () => response,
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('KOMSA maritime traffic request returned a non-success status');
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('redacts the credential and request URL from transport errors', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const serviceKey = 'synthetic-komsa-secret';
    let caught: unknown;
    try {
      await fetchSnapshot({
        fetcher: async (input) => {
          throw new Error(String(input));
        },
        serviceKey,
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('KOMSA maritime traffic request failed');
    expect((caught as Error).message).not.toContain(serviceKey);
    expect((caught as Error).message).not.toContain('serviceKey');
  });

  it('propagates an abort reason without issuing a provider request', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const reason = new DOMException('cancelled by gateway', 'AbortError');
    const controller = new AbortController();
    controller.abort(reason);
    const fetcher = vi.fn(async () => Response.json(fixture));

    await expect(
      fetchSnapshot({
        fetcher,
        serviceKey: 'synthetic-komsa-secret',
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a JSON-shaped response with an unapproved MIME type', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    await expect(
      fetchSnapshot({
        fetcher: async () =>
          new Response(JSON.stringify(fixture), {
            headers: { 'content-type': 'text/html;charset=utf-8' },
          }),
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('KOMSA maritime traffic response content type is invalid');
  });

  it('rejects a response whose declared body exceeds the parser budget', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    await expect(
      fetchSnapshot({
        fetcher: async () =>
          new Response(JSON.stringify(fixture), {
            headers: {
              'content-length': String(2 * 1024 * 1024 + 1),
              'content-type': 'application/json',
            },
          }),
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('KOMSA maritime traffic response size exceeds the allowed limit');
  });

  it('stops reading an undeclared response when it crosses the parser budget', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    await expect(
      fetchSnapshot({
        fetcher: async () =>
          new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
            headers: { 'content-type': 'application/json' },
          }),
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('KOMSA maritime traffic response size exceeds the allowed limit');
  });

  it('rejects a response whose final URL differs from the fixed endpoint', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    await expect(
      fetchSnapshot({
        fetcher: async () => {
          const response = Response.json(fixture);
          Object.defineProperty(response, 'url', {
            configurable: true,
            value: 'https://example.invalid/redirected',
          });
          return response;
        },
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError('KOMSA maritime traffic redirect is not allowed');
  });

  it('sanitizes malformed JSON without exposing the upstream body', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const unsafeBody = '{"providerSecret":"unsafe-fragment"';
    let caught: unknown;
    try {
      await fetchSnapshot({
        fetcher: async () =>
          new Response(unsafeBody, {
            headers: { 'content-type': 'application/json' },
          }),
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('KOMSA maritime traffic response was not valid JSON');
    expect((caught as Error).message).not.toContain('unsafe-fragment');
  });

  it('accepts the documented single-item object and a successful zero-row page', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const single = cloneFixture();
    const firstRow = fixtureRows(single)[0];
    expect(firstRow).toBeDefined();
    if (firstRow === undefined) {
      return;
    }
    fixtureBody(single).items.item = firstRow;
    fixtureBody(single).totalCount = 1;

    await expect(
      fetchSnapshot({
        fetcher: async () => Response.json(single),
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      cells: [{ gridId: firstRow.grid_id }],
    });

    const empty = cloneFixture();
    fixtureBody(empty).items.item = [];
    fixtureBody(empty).totalCount = 0;
    await expect(
      fetchSnapshot({
        fetcher: async () => Response.json(empty),
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      cells: [],
      generatedAt: Date.parse('2026-07-31T03:30:00.000Z'),
    });
  });

  it('rejects a provider failure without exposing resultMsg', async () => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const input = cloneFixture() as {
      response: { header: { resultCode: string; resultMsg: string } };
    };
    input.response.header.resultCode = '30';
    input.response.header.resultMsg = 'unsafe provider account detail';

    let caught: unknown;
    try {
      await fetchSnapshot({
        fetcher: async () => Response.json(input),
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('KOMSA maritime traffic provider returned a non-success result');
    expect((caught as Error).message).not.toContain('unsafe provider account detail');
  });

  it.each([
    [
      'a wrong page',
      (input: Record<string, unknown>) => {
        fixtureBody(input).pageNo = 2;
      },
      'KOMSA maritime traffic pagination is invalid',
    ],
    [
      'a changed page size',
      (input: Record<string, unknown>) => {
        fixtureBody(input).numOfRows = 10;
      },
      'KOMSA maritime traffic pagination is invalid',
    ],
    [
      'a truncated page',
      (input: Record<string, unknown>) => {
        fixtureBody(input).totalCount = 3;
      },
      'KOMSA maritime traffic pagination is invalid',
    ],
    [
      'a result beyond the provisional page cap',
      (input: Record<string, unknown>) => {
        fixtureBody(input).totalCount = 5_001;
      },
      'KOMSA maritime traffic pagination is invalid',
    ],
    [
      'a duplicate grid identifier',
      (input: Record<string, unknown>) => {
        const rows = fixtureRows(input);
        rows.push(structuredClone(rows[0] ?? {}));
        fixtureBody(input).totalCount = rows.length;
      },
      'KOMSA maritime traffic response contains a duplicate grid identifier',
    ],
    [
      'a non-canonical grid identifier',
      (input: Record<string, unknown>) => {
        const row = fixtureRows(input)[0];
        if (row !== undefined) {
          row.grid_id = ' G3SYNTHETIC_B2 ';
        }
      },
      'KOMSA maritime traffic response is invalid',
    ],
    [
      'a fractional vessel count',
      (input: Record<string, unknown>) => {
        const row = fixtureRows(input)[0];
        if (row !== undefined) {
          row.vmtc = 1.5;
        }
      },
      'KOMSA maritime traffic response is invalid',
    ],
    [
      'a negative vessel count',
      (input: Record<string, unknown>) => {
        const row = fixtureRows(input)[0];
        if (row !== undefined) {
          row.vmtc = -1;
        }
      },
      'KOMSA maritime traffic response is invalid',
    ],
    [
      'an out-of-range density',
      (input: Record<string, unknown>) => {
        const row = fixtureRows(input)[0];
        if (row !== undefined) {
          row.dnsty = 100.1;
        }
      },
      'KOMSA maritime traffic response is invalid',
    ],
    [
      'an undocumented response field',
      (input: Record<string, unknown>) => {
        const row = fixtureRows(input)[0];
        if (row !== undefined) {
          row.mmsi = 'synthetic-identifier';
        }
      },
      'KOMSA maritime traffic response is invalid',
    ],
    [
      'a non-JSON data type marker',
      (input: Record<string, unknown>) => {
        fixtureBody(input).dataType = 'XML';
      },
      'KOMSA maritime traffic response is invalid',
    ],
    [
      'an unsupported generation timestamp shape',
      (input: Record<string, unknown>) => {
        fixtureBody(input).regDt = '2026/07/31 12:30:00';
      },
      'KOMSA maritime traffic generation timestamp is invalid',
    ],
    [
      'an impossible generation date',
      (input: Record<string, unknown>) => {
        fixtureBody(input).regDt = '2026-02-30 12:30:00';
      },
      'KOMSA maritime traffic generation timestamp is invalid',
    ],
  ])('rejects %s instead of guessing', async (_label, mutate, expectedMessage) => {
    const fetchSnapshot = komsa.fetchMaritimeTrafficSnapshot as FetchSnapshot | undefined;

    expect(fetchSnapshot).toBeTypeOf('function');
    if (fetchSnapshot === undefined) {
      return;
    }

    const input = cloneFixture();
    mutate(input);
    await expect(
      fetchSnapshot({
        fetcher: async () => Response.json(input),
        serviceKey: 'synthetic-komsa-secret',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError(expectedMessage);
  });
});
