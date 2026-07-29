// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import * as disasterRouteModule from '../../../src/server/routes/disaster';

const disasterRoute = disasterRouteModule as Record<string, unknown>;
const now = Date.parse('2026-07-29T08:00:00.000Z');

const createRoute = (overrides: Record<string, unknown> = {}) => {
  const factory = disasterRoute.createDisasterRoute as
    | ((options: Record<string, unknown>) => {
        parseRequest(request: Request): unknown;
        path: string;
        profile: Record<string, unknown>;
        load(input: Record<string, never>, signal: AbortSignal): Promise<unknown>;
      })
    | undefined;
  expect(factory).toBeTypeOf('function');
  if (factory === undefined) {
    throw new TypeError('createDisasterRoute is missing');
  }
  return factory({
    clock: () => now,
    fetcher: vi.fn(),
    readAdmissionSubject: () => createAdmissionSubject('disaster-test'),
    serviceKey: 'synthetic-safetydata-secret',
    ...overrides,
  });
};

describe('disaster alert gateway route', () => {
  it('uses a fixed queryless identity and a quota-safe three-minute origin profile', () => {
    const route = createRoute();

    expect(route.path).toBe('/api/disaster');
    expect(route.parseRequest(new Request('https://balance.test/api/disaster'))).toEqual({
      admissionSubject: createAdmissionSubject('disaster-test'),
      input: {},
      publicCacheIdentity: { scope: 'korea-disaster-alerts' },
    });
    expect(() => route.parseRequest(new Request('https://balance.test/api/disaster?region=seoul'))).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
    expect(route.profile).toMatchObject({
      admissionRate: {
        limit: 120,
        scope: 'route.disaster',
        windowMs: 60_000,
      },
      cdnMaxAgeSeconds: 60,
      breaker: {
        cooldownMs: 30_000,
        failureThreshold: 3,
        failureWindowMs: 60_000,
        probeTimeoutMs: 5_000,
        scope: 'provider.safetydata-disaster',
      },
      freshForMs: 3 * 60_000,
      negativeForMs: 3 * 60_000,
      staleIfErrorForMs: 60 * 60_000,
      upstreamTimeoutMs: 8_000,
      upstreamBudget: {
        limit: 480,
        scope: 'provider.safetydata-disaster',
        windowMs: 24 * 60 * 60_000,
      },
    });
  });

  it('loads a strict original-message snapshot with explicit provisional attribution', async () => {
    const success = {
      header: { errorMsg: '', resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      numOfRows: 500,
      pageNo: 1,
      totalCount: 1,
      body: [
        {
          MSG_CN: '[행정안전부]  원문을 그대로 표시합니다.',
          RCPTN_RGN_NM: '서울특별시 전체',
          CRT_DT: '2026/07/29 16:30:00',
          REG_YMD: '2026-07-29',
          EMRG_STEP_NM: '긴급재난',
          SN: 9003,
          DST_SE_NM: '호우',
          MDFCN_YMD: '2026-07-29',
        },
      ],
    };
    const route = createRoute({
      fetcher: vi.fn(async () => Response.json(success)),
    });

    await expect(route.load({}, new AbortController().signal)).resolves.toEqual({
      kind: 'value',
      data: {
        alerts: [
          {
            disasterType: '호우',
            emergencyStep: '긴급재난',
            id: '9003',
            issuedAt: Date.parse('2026-07-29T07:30:00.000Z'),
            message: '[행정안전부]  원문을 그대로 표시합니다.',
            regionText: '서울특별시 전체',
          },
        ],
      },
      fetchedAt: now,
      source: '행정안전부 · 재난안전데이터공유플랫폼 · 공공누리 제4유형 기준',
    });
  });

  it('fails closed before transport when the dedicated credential is absent or blank', async () => {
    const fetcher = vi.fn();
    const route = createRoute({ fetcher, serviceKey: '   ' });

    await expect(route.load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a provider error envelope to safe UPSTREAM_UNAVAILABLE without exposing raw detail', async () => {
    const rawMarker = 'RAW_SAFETYDATA_DETAIL_MUST_NOT_ESCAPE';
    const route = createRoute({
      fetcher: vi.fn(async () =>
        Response.json({
          body: null,
          header: {
            errorMsg: rawMarker,
            resultCode: '30',
            resultMsg: rawMarker,
          },
          numOfRows: 500,
          pageNo: 1,
          totalCount: 0,
        }),
      ),
    });
    let thrown: unknown;

    try {
      await route.load({}, new AbortController().signal);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain(rawMarker);
    expect(`${String(thrown)}${JSON.stringify(thrown)}`).not.toContain('synthetic-safetydata-secret');
  });

  it('preserves the supplied abort reason instead of reclassifying it', async () => {
    const controller = new AbortController();
    const reason = new Error('fixture request deadline');
    const route = createRoute({
      fetcher: vi.fn(async (): Promise<Response> => {
        controller.abort(reason);
        throw new TypeError('provider fetch aborted');
      }),
    });

    await expect(route.load({}, controller.signal)).rejects.toBe(reason);
  });
});
