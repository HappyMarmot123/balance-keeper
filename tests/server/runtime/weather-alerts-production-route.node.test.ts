// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { weatherAlertDataSchema } from '../../../src/entities/weather-alert/contract';
import { createStateKey, MemoryFleetStateStore } from '../../../src/server/cache';
import {
  createGatewayRuntime,
  createProductionGatewayRuntime,
  withTrustedAdmissionSubject,
} from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const fixtureDirectory = resolve(import.meta.dirname, '../../fixtures/kma');
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8')) as unknown;
const toUrl = (input: RequestInfo | URL): URL =>
  new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);

const ACTIVE_STATUS_FIXTURE = 'weather-alert-status-active.json';
const EMPTY_STATUS_FIXTURE = 'weather-alert-status-empty.json';
const ACTIVE_CODES_FIXTURE = 'weather-alert-codes-active.json';
const BULLETIN_FIXTURE = 'weather-alert-message-success.json';
const NOW = Date.parse('2026-07-31T10:30:00+09:00');

describe('weather alerts production route registration', () => {
  it('registers the 30-second alerts route only in the production assembly', () => {
    const productionRuntime = createProductionGatewayRuntime({
      environment: {},
      logWriter: () => undefined,
    });
    const genericRuntime = createGatewayRuntime({
      environment: {},
      fleetStateStore: new MemoryFleetStateStore(() => NOW),
    });

    expect(productionRuntime.getCdnMaxAgeSeconds('/api/weather/alerts')).toBe(30);
    expect(genericRuntime.getCdnMaxAgeSeconds('/api/weather/alerts')).toBeUndefined();
  });

  it('serves a strict MISS, HIT and matching 304 after one bounded three-request KMA acquisition', async () => {
    const serviceKey = 'canonical-weather-alert-fixture-key';
    const requestedUrls: URL[] = [];
    let requestSequence = 0;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = toUrl(input);
      requestedUrls.push(url);

      switch (url.pathname) {
        case '/1360000/WthrWrnInfoService/getPwnStatus':
          return Response.json(readFixture(ACTIVE_STATUS_FIXTURE));
        case '/1360000/WthrWrnInfoService/getPwnCd':
          return Response.json(readFixture(ACTIVE_CODES_FIXTURE));
        case '/1360000/WthrWrnInfoService/getWthrWrnMsg':
          return Response.json(readFixture(BULLETIN_FIXTURE));
        default:
          return Response.json({ error: 'unexpected provider path' }, { status: 404 });
      }
    };
    const runtime = createProductionGatewayRuntime({
      clock: () => NOW,
      createCoordinationToken: () => 'coordination-weather-alerts',
      createRequestId: () => `request-weather-alerts-${++requestSequence}`,
      environment: { DATA_GO_KR_SERVICE_KEY: serviceKey },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => NOW),
      logWriter: () => undefined,
    });
    const request = (ifNoneMatch?: string) =>
      withTrustedAdmissionSubject(
        new Request('https://balance.test/api/weather/alerts', {
          ...(ifNoneMatch === undefined ? {} : { headers: { 'If-None-Match': ifNoneMatch } }),
        }),
        '203.0.113.50',
      );

    const missResponse = await runtime.handle(request());
    const etag = missResponse.headers.get('etag');
    const missEnvelope = successEnvelopeSchema(weatherAlertDataSchema).parse(await missResponse.json());
    const hitResponse = await runtime.handle(request());
    const hitEnvelope = successEnvelopeSchema(weatherAlertDataSchema).parse(await hitResponse.json());
    if (etag === null) {
      throw new TypeError('Weather alerts MISS must include an ETag');
    }
    const notModifiedResponse = await runtime.handle(request(etag));

    expect(missResponse.status).toBe(200);
    expect(missEnvelope).toMatchObject({
      data: {
        alerts: [
          { areaCode: 'L1010100', kind: 'heat-wave', level: 'warning' },
          { areaCode: 'L1020000', kind: 'heat-wave', level: 'advisory' },
        ],
      },
      meta: {
        cache: 'MISS',
        fetchedAt: NOW,
        requestId: 'request-weather-alerts-1',
        source: 'KMA',
      },
    });
    expect(hitResponse.status).toBe(200);
    expect(hitEnvelope.data).toEqual(missEnvelope.data);
    expect(hitEnvelope.meta).toMatchObject({
      cache: 'HIT',
      fetchedAt: NOW,
      requestId: 'request-weather-alerts-2',
      source: 'KMA',
    });
    expect(notModifiedResponse.status).toBe(304);
    expect(notModifiedResponse.headers.get('etag')).toBe(etag);
    expect(notModifiedResponse.headers.get('x-request-id')).toBe('request-weather-alerts-3');
    await expect(notModifiedResponse.text()).resolves.toBe('');

    expect(requestedUrls).toHaveLength(3);
    expect(new Set(requestedUrls.map((url) => url.pathname))).toEqual(
      new Set([
        '/1360000/WthrWrnInfoService/getPwnStatus',
        '/1360000/WthrWrnInfoService/getPwnCd',
        '/1360000/WthrWrnInfoService/getWthrWrnMsg',
      ]),
    );
    expect(requestedUrls.every((url) => url.searchParams.get('serviceKey') === serviceKey)).toBe(true);
    expect(JSON.stringify([missEnvelope, hitEnvelope])).not.toContain(serviceKey);
  });

  it('reserves three shared KMA budget units before starting weather-alert transport', async () => {
    const fleetStateStore = new MemoryFleetStateStore(() => NOW);
    await fleetStateStore.consumeFixedWindow(
      createStateKey('rate', 'provider.kma'),
      { limit: 7_000, windowMs: 24 * 60 * 60_000 },
      6_998,
    );
    const fetcher = vi.fn<typeof fetch>();
    const runtime = createProductionGatewayRuntime({
      clock: () => NOW,
      createCoordinationToken: () => 'coordination-weather-alerts-weighted-budget',
      createRequestId: () => 'request-weather-alerts-weighted-budget',
      environment: { DATA_GO_KR_SERVICE_KEY: 'canonical-weather-alert-budget-key' },
      fetcher,
      fleetStateStore,
      logWriter: () => undefined,
    });

    const response = await runtime.handle(
      withTrustedAdmissionSubject(new Request('https://balance.test/api/weather/alerts'), '203.0.113.54'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        requestId: 'request-weather-alerts-weighted-budget',
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('replaces an active snapshot with a successful empty result without reviving the old alert as stale', async () => {
    let now = NOW;
    let mode: 'active' | 'empty' | 'failure' = 'active';
    let providerRequestCount = 0;
    let requestSequence = 0;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      providerRequestCount += 1;
      const url = toUrl(input);
      if (url.pathname.endsWith('/getPwnStatus')) {
        if (mode === 'failure') {
          return Response.json({ error: 'synthetic upstream failure' }, { status: 502 });
        }
        return Response.json(readFixture(mode === 'empty' ? EMPTY_STATUS_FIXTURE : ACTIVE_STATUS_FIXTURE));
      }
      if (url.pathname.endsWith('/getPwnCd')) {
        return Response.json(readFixture(ACTIVE_CODES_FIXTURE));
      }
      if (url.pathname.endsWith('/getWthrWrnMsg')) {
        return Response.json(readFixture(BULLETIN_FIXTURE));
      }
      return Response.json({ error: 'unexpected provider path' }, { status: 404 });
    };
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => `coordination-weather-alerts-transition-${requestSequence}`,
      createRequestId: () => `request-weather-alerts-transition-${++requestSequence}`,
      environment: { DATA_GO_KR_SERVICE_KEY: 'canonical-weather-alert-transition-key' },
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const request = () =>
      withTrustedAdmissionSubject(new Request('https://balance.test/api/weather/alerts'), '203.0.113.51');

    const activeResponse = await runtime.handle(request());
    const activeEnvelope = successEnvelopeSchema(weatherAlertDataSchema).parse(await activeResponse.json());

    mode = 'empty';
    now += 60_001;
    const emptyResponse = await runtime.handle(request());
    const emptyEnvelope = successEnvelopeSchema(weatherAlertDataSchema).parse(await emptyResponse.json());

    mode = 'failure';
    now += 60_001;
    const failedResponse = await runtime.handle(request());
    const failedBody = await failedResponse.json();

    expect(activeEnvelope.data?.alerts).toHaveLength(2);
    expect(emptyResponse.status).toBe(200);
    expect(emptyEnvelope).toMatchObject({
      data: null,
      meta: { cache: 'MISS', source: 'KMA' },
    });
    expect(failedResponse.status).toBe(502);
    expect(failedBody).toEqual({
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        requestId: 'request-weather-alerts-transition-3',
      },
    });
    expect(JSON.stringify(failedBody)).not.toContain('L1010100');
    expect(providerRequestCount).toBe(5);
  });

  it('returns a safe missing-credential response without starting KMA transport', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const runtime = createProductionGatewayRuntime({
      clock: () => NOW,
      createCoordinationToken: () => 'coordination-weather-alerts-missing',
      createRequestId: () => 'request-weather-alerts-missing',
      environment: {},
      fetcher,
      fleetStateStore: new MemoryFleetStateStore(() => NOW),
      logWriter: () => undefined,
    });

    const response = await runtime.handle(
      withTrustedAdmissionSubject(new Request('https://balance.test/api/weather/alerts'), '203.0.113.52'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'MISSING_CREDENTIALS',
        requestId: 'request-weather-alerts-missing',
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
