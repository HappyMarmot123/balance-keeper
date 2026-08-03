// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';

const now = Date.parse('2026-08-03T15:20:00+09:00');

const createRequest = (path: string, headers?: HeadersInit) =>
  withTrustedAdmissionSubject(new Request(`https://balance.test${path}`, { headers }), '203.0.113.129');

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const emptyEnvelope = {
  header: { resultCode: '0', resultMsg: 'SUCCESS' },
  body: { totalCount: 0, items: [] },
};

describe('road guidance production gateway registration', () => {
  it.each([
    ['/api/road-guidance/vms', '/vmsInfo'],
    ['/api/road-guidance/safety-notices', '/posIncidentInfo'],
    ['/api/road-guidance/variable-speed-limits', '/vslInfo'],
  ] as const)('registers %s with cache and conditional response behavior', async (path, upstreamPath) => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = input instanceof Request ? input.url : input.toString();
      expect(new URL(requestUrl).pathname).toBe(upstreamPath);
      return jsonResponse(emptyEnvelope);
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-${upstreamPath}`,
      createRequestId: () => `request-${upstreamPath}`,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    const response = await runtime.handle(createRequest(path));
    const body = (await response.json()) as {
      data?: { channel?: string; items?: unknown[] };
      meta?: { cache?: string };
    };

    expect(response.status).toBe(200);
    expect(body.data?.items).toEqual([]);
    expect(body.meta?.cache).toBe('MISS');
    expect(JSON.stringify(body)).not.toContain('synthetic-its-secret');

    const etag = response.headers.get('etag');
    expect(etag).not.toBeNull();
    const hitResponse = await runtime.handle(createRequest(path));
    const hitBody = (await hitResponse.json()) as { data?: unknown; meta?: { cache?: string } };
    expect(hitResponse.status).toBe(200);
    expect(hitBody).toMatchObject({ data: body.data, meta: { cache: 'HIT' } });
    const notModified = await runtime.handle(createRequest(path, { 'If-None-Match': etag ?? '' }));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['/api/road-guidance/dangerous-materials', '/api/road-guidance/unknown'])(
    'keeps an unapproved path outside the public registry: %s',
    async (path) => {
      const fetcher = vi.fn(async () => jsonResponse(emptyEnvelope));
      const runtime = createProductionGatewayRuntime({
        clock: () => now,
        environment: { ITS_API_KEY: 'synthetic-its-secret' },
        fetcher,
        fleetStateStore: new MemoryFleetStateStore(() => now),
        logWriter: () => undefined,
      });

      const response = await runtime.handle(createRequest(path));

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(['/api/road-guidance/vms', '/api/road-guidance/safety-notices', '/api/road-guidance/variable-speed-limits'])(
    'sanitizes an initial provider failure from output and logs for %s',
    async (path) => {
      const logs: string[] = [];
      const fetcher = vi.fn(async () => {
        throw new Error('raw-road-guidance-marker apiKey=synthetic-its-secret');
      });
      const runtime = createProductionGatewayRuntime({
        clock: () => now,
        createCoordinationToken: () => `coordination-failure-${path}`,
        createRequestId: () => `request-failure-${path}`,
        environment: { ITS_API_KEY: 'synthetic-its-secret' },
        fetcher,
        fleetStateStore: new MemoryFleetStateStore(() => now),
        logWriter: (line) => logs.push(line),
      });

      const response = await runtime.handle(createRequest(path));
      const serialized = JSON.stringify([await response.json(), logs]);

      expect(response.status).toBe(502);
      expect(JSON.parse(serialized)[0]).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
      expect(serialized).not.toContain('synthetic-its-secret');
      expect(serialized).not.toContain('raw-road-guidance-marker');
      expect(serialized).not.toContain('apiKey=');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
