// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';

const now = Date.parse('2026-08-03T15:20:00+09:00');

const createRequest = (path: string, headers?: HeadersInit) =>
  withTrustedAdmissionSubject(new Request(`https://balance.test${path}`, { headers }), '203.0.113.128');

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const incidentFixture = {
  resultCode: '0',
  resultMsg: 'SUCCESS',
  totalCount: 1,
  data: [
    {
      type: '국도',
      eventType: '교통사고',
      eventDetailType: '사고',
      startDate: '20260803120000',
      coordX: '127.01',
      coordY: '37.51',
      linkId: 'synthetic-link',
      roadName: '테스트로',
      roadNo: '1',
      roadDrcType: '상행',
      lanesBlockType: '',
      lanesBlocked: '',
      message: '합성 교통 돌발',
      endDate: '',
    },
  ],
};

const disasterFixture = {
  resultCode: '0',
  resultMsg: 'SUCCESS',
  totalCount: 1,
  data: [
    {
      category: 'D',
      eventId: 'synthetic-disaster',
      eventType: 'D03',
      eventDetailType: '1',
      status: '발표',
      startDate: '20260803110000',
      endDate: '202608041200',
      socName: '합성 지점',
      socExtent: '',
      locationInfoType: '1',
      locationInfo: '127.02 37.52',
      locationGeometry: '',
      linkId: 'synthetic-disaster-link',
      roadName: '테스트로',
      roadNo: '',
      roadDrcType: '',
      lanesBlockType: '',
      lanesBlocked: '',
      message: '합성 재난 신호',
    },
  ],
};

describe('road event production gateway registration', () => {
  it.each([
    ['/api/road-events/incidents', '/eventInfo', incidentFixture, 'incidents'],
    ['/api/road-events/disasters', '/disasterInfo', disasterFixture, 'disasters'],
  ] as const)('registers %s in the coarse gateway', async (path, upstreamPath, fixture, channel) => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = input instanceof Request ? input.url : input.toString();
      expect(new URL(requestUrl).pathname).toBe(upstreamPath);
      return jsonResponse(fixture);
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-road-events-${channel}`,
      createRequestId: () => `request-road-events-${channel}`,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    const response = await runtime.handle(createRequest(path));
    const body = (await response.json()) as {
      data?: { channel?: string; events?: unknown[] };
      meta?: { cache?: string };
    };

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ channel, events: [expect.any(Object)] });
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

  it('keeps dangerous-car precise history outside the public registry', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ unsafe: true }));
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    const response = await runtime.handle(createRequest('/api/road-events/dangerous-materials'));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sanitizes an initial ITS road-event failure from public output and logs', async () => {
    const logs: string[] = [];
    const fetcher = vi.fn(async () => {
      throw new Error('raw-road-event-marker apiKey=synthetic-its-secret');
    });
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-road-events-failure',
      createRequestId: () => 'request-road-events-failure',
      environment: { ITS_API_KEY: 'synthetic-its-secret' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: (line) => logs.push(line),
    });

    const response = await runtime.handle(createRequest('/api/road-events/incidents'));
    const serialized = JSON.stringify([await response.json(), logs]);

    expect(response.status).toBe(502);
    expect(JSON.parse(serialized)[0]).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
    expect(serialized).not.toContain('synthetic-its-secret');
    expect(serialized).not.toContain('raw-road-event-marker');
    expect(serialized).not.toContain('apiKey=');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
