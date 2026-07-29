// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { disasterDataSchema } from '../../../src/entities/disaster/contract';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createProductionGatewayRuntime, withTrustedAdmissionSubject } from '../../../src/server/runtime';
import { successEnvelopeSchema } from '../../../src/shared/contracts';

const now = Date.parse('2026-07-29T08:00:00.000Z');
const source = '행정안전부 · 재난안전데이터공유플랫폼 · 공공누리 제4유형 기준';

const createProviderRow = () => ({
  MSG_CN: '하천 범람 위험이 있으니 안전한 곳으로 대피하십시오.',
  RCPTN_RGN_NM: '서울특별시 일부',
  CRT_DT: '2026/07/29 16:30:00',
  REG_YMD: '2026-07-29',
  EMRG_STEP_NM: '긴급재난',
  SN: 9003,
  DST_SE_NM: '홍수',
  MDFCN_YMD: '2026-07-29',
});

const createProviderResponse = (body: readonly ReturnType<typeof createProviderRow>[] | null) => ({
  header: { errorMsg: '', resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
  numOfRows: 500,
  pageNo: 1,
  totalCount: body?.length ?? 0,
  body,
});

describe('disaster alert production route registration', () => {
  it('registers /api/disaster with its dedicated server credential and strict snapshot', async () => {
    const serviceKey = 'synthetic-safetydata-key';
    let requestSequence = 0;
    let providerRequests = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-disaster',
      createRequestId: () => `disaster-runtime-${++requestSequence}`,
      environment: { SAFETY_DATA_SERVICE_KEY: serviceKey },
      fetcher: async () => {
        providerRequests += 1;
        return Response.json(createProviderResponse([createProviderRow()]));
      },
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    expect(runtime.getCdnMaxAgeSeconds('/api/disaster')).toBe(60);
    const response = await runtime.handle(
      withTrustedAdmissionSubject(new Request('https://balance.test/api/disaster'), '203.0.113.44'),
    );
    const envelope = successEnvelopeSchema(disasterDataSchema).parse(await response.json());

    expect(response.status).toBe(200);
    expect(providerRequests).toBe(1);
    expect(envelope.data.alerts).toHaveLength(1);
    expect(envelope.meta).toMatchObject({
      cache: 'MISS',
      requestId: 'disaster-runtime-1',
      source,
    });
    expect(JSON.stringify(envelope)).not.toContain(serviceKey);
  });

  it('caches an empty provider snapshot and returns a bodyless 304 for its current ETag', async () => {
    let requestSequence = 0;
    let providerRequests = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createCoordinationToken: () => 'coordination-disaster-empty',
      createRequestId: () => `disaster-empty-${++requestSequence}`,
      environment: { SAFETY_DATA_SERVICE_KEY: 'synthetic-safetydata-key' },
      fetcher: async () => {
        providerRequests += 1;
        return Response.json(createProviderResponse(null));
      },
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });
    const createRequest = (headers?: HeadersInit) =>
      withTrustedAdmissionSubject(
        new Request('https://balance.test/api/disaster', headers === undefined ? undefined : { headers }),
        '203.0.113.45',
      );

    const missResponse = await runtime.handle(createRequest());
    const etag = missResponse.headers.get('etag');
    const missEnvelope = successEnvelopeSchema(disasterDataSchema).parse(await missResponse.json());
    const hitResponse = await runtime.handle(createRequest());
    const hitEnvelope = successEnvelopeSchema(disasterDataSchema).parse(await hitResponse.json());
    const revalidatedResponse = await runtime.handle(createRequest({ 'If-None-Match': etag?.replace('W/', '') ?? '' }));

    expect(missEnvelope).toMatchObject({
      data: { alerts: [] },
      meta: { cache: 'MISS', source },
    });
    expect(hitEnvelope.meta.cache).toBe('HIT');
    expect(revalidatedResponse.status).toBe(304);
    expect(await revalidatedResponse.text()).toBe('');
    expect(providerRequests).toBe(1);
  });

  it('serves the last successful snapshot as explicit STALE after a transient provider failure', async () => {
    let currentTime = now;
    let providerShouldFail = false;
    let providerRequests = 0;
    let requestSequence = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => currentTime,
      createCoordinationToken: () => `coordination-disaster-stale-${requestSequence}`,
      createRequestId: () => `disaster-stale-${++requestSequence}`,
      environment: { SAFETY_DATA_SERVICE_KEY: 'synthetic-safetydata-key' },
      fetcher: async () => {
        providerRequests += 1;
        if (providerShouldFail) {
          return new Response(null, { status: 503 });
        }
        return Response.json(createProviderResponse([createProviderRow()]));
      },
      fleetStateStore: new MemoryFleetStateStore(() => currentTime),
      logWriter: () => undefined,
    });
    const createRequest = () =>
      withTrustedAdmissionSubject(new Request('https://balance.test/api/disaster'), '203.0.113.46');

    const missResponse = await runtime.handle(createRequest());
    const missEnvelope = successEnvelopeSchema(disasterDataSchema).parse(await missResponse.json());
    providerShouldFail = true;
    currentTime += 3 * 60_000 + 1;
    const staleResponse = await runtime.handle(createRequest());
    const staleEnvelope = successEnvelopeSchema(disasterDataSchema).parse(await staleResponse.json());

    expect(missEnvelope.meta.cache).toBe('MISS');
    expect(staleResponse.status).toBe(200);
    expect(staleResponse.headers.get('cache-control')).toBe('no-store');
    expect(staleEnvelope.data).toEqual(missEnvelope.data);
    expect(staleEnvelope.meta).toMatchObject({
      cache: 'STALE',
      fetchedAt: missEnvelope.meta.fetchedAt,
      source,
    });
    expect(providerRequests).toBe(2);
  });

  it('returns MISSING_CREDENTIALS without starting provider transport', async () => {
    let providerRequests = 0;
    const runtime = createProductionGatewayRuntime({
      clock: () => now,
      createRequestId: () => 'disaster-missing-credential',
      environment: {},
      fetcher: async () => {
        providerRequests += 1;
        return Response.json(createProviderResponse([createProviderRow()]));
      },
      fleetStateStore: new MemoryFleetStateStore(() => now),
      logWriter: () => undefined,
    });

    const response = await runtime.handle(
      withTrustedAdmissionSubject(new Request('https://balance.test/api/disaster'), '203.0.113.47'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'MISSING_CREDENTIALS',
        requestId: 'disaster-missing-credential',
      },
    });
    expect(providerRequests).toBe(0);
  });
});
