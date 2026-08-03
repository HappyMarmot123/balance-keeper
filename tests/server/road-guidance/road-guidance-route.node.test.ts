// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';

const now = Date.parse('2026-08-03T15:20:00+09:00');
const routeModulePath = '../../../src/server/routes/road-guidance/index.ts';

type RoadGuidanceRoute = Readonly<{
  load(
    input: Record<string, never>,
    signal: AbortSignal,
  ): Promise<{
    data: Readonly<{ channel: string; generatedAt: number; items: readonly unknown[] }>;
    fetchedAt: number;
    kind: 'empty' | 'value';
    source: string;
  }>;
  parseRequest(request: Request): unknown;
}>;

type CreateRoadGuidanceRoute = (
  options: Readonly<{
    clock?: () => number;
    fetcher?: typeof fetch;
    readAdmissionSubject: (request: Request) => ReturnType<typeof createAdmissionSubject>;
    serviceKey?: string;
  }>,
) => RoadGuidanceRoute;

let routeApi: Readonly<Record<string, unknown>> = {};

beforeAll(async () => {
  if (existsSync(resolve(process.cwd(), 'src/server/routes/road-guidance/index.ts'))) {
    routeApi = (await import(/* @vite-ignore */ routeModulePath)) as Readonly<Record<string, unknown>>;
  }
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const envelope = (items: readonly Record<string, unknown>[]) => ({
  header: { resultCode: '0', resultMsg: 'SUCCESS' },
  body: { totalCount: items.length, items },
});

const fixtures = {
  createSafetyNoticeRoute: {
    channel: 'safety-notices',
    item: {
      message: '합성 주의운전 안내',
      occrrncId: 'synthetic-occurrence',
      outbrkType: '1',
      priority: '1',
      revRoadDrcType: '상행',
      revRouteName: '합성 역방향 도로',
      revRouteNo: '2',
      revStdLinkId: 'synthetic-reverse-link',
      revX: '127.02',
      revY: '37.52',
      roadDrcType: '하행',
      routeName: '합성 도로',
      routeNo: '1',
      startStdLinkId: 'synthetic-start-link',
      startX: '127.01',
      startY: '37.51',
      stepType: '1',
    },
    path: '/api/road-guidance/safety-notices',
    profile: 'SAFETY_NOTICE_ROUTE_PROFILE',
    scope: 'korea-road-guidance-safety-notices',
  },
  createVariableSpeedLimitRoute: {
    channel: 'variable-speed-limits',
    item: {
      coordX: '127.01',
      coordY: '37.51',
      createdDate: '20260803151900',
      defLmtSpeed: '100',
      limitSpeed: '80',
      linkId: '',
      registedDate: '20260803151930',
      roadNo: '1',
      sectionCode: '1',
      vslId: 'synthetic-vsl',
    },
    path: '/api/road-guidance/variable-speed-limits',
    profile: 'VARIABLE_SPEED_LIMIT_ROUTE_PROFILE',
    scope: 'korea-road-guidance-variable-speed-limits',
  },
  createVmsGuidanceRoute: {
    channel: 'vms',
    item: {
      coordX: '127.01',
      coordY: '37.51',
      createdDate: '20260803151900',
      message: '합성 도로 안내',
      messageNo: '1',
      roadDrcType: '상행',
      roadGrad: '1',
      roadName: '합성 도로',
      routeNo: '1',
      vmsId: 'synthetic-vms',
    },
    path: '/api/road-guidance/vms',
    profile: 'VMS_GUIDANCE_ROUTE_PROFILE',
    scope: 'korea-road-guidance-vms',
  },
} as const;

describe('road guidance route boundary', () => {
  it('publishes the three approved queryless route factories', () => {
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/road-guidance/roadGuidanceRoutes.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/server/routes/road-guidance/index.ts'))).toBe(true);
    for (const factoryName of Object.keys(fixtures)) {
      expect(routeApi[factoryName]).toBeTypeOf('function');
    }
  });

  it.each(Object.entries(fixtures))(
    'isolates the fixed public cache identity for %s and rejects every query',
    (factoryName, fixture) => {
      const createRoute = routeApi[factoryName] as CreateRoadGuidanceRoute | undefined;
      expect(createRoute).toBeTypeOf('function');
      if (createRoute === undefined) return;
      const readAdmissionSubject = vi.fn(() => createAdmissionSubject(`opaque-${fixture.channel}`));
      const route = createRoute({ readAdmissionSubject });
      const request = new Request(`https://balance.test${fixture.path}`);

      expect(route.parseRequest(request)).toEqual({
        admissionSubject: `opaque-${fixture.channel}`,
        input: {},
        publicCacheIdentity: { scope: fixture.scope },
      });
      expect(readAdmissionSubject).toHaveBeenCalledWith(request);
      for (const query of ['?bbox=124,32,132,40', '?page=1', '?channel=other']) {
        expect(() => route.parseRequest(new Request(`https://balance.test${fixture.path}${query}`))).toThrowError(
          expect.objectContaining({ code: 'BAD_REQUEST' }),
        );
      }
    },
  );
});

describe('road guidance route profiles and loaders', () => {
  it.each([
    [
      'VMS_GUIDANCE_ROUTE_PROFILE',
      {
        admissionRate: { limit: 60, scope: 'route.road-guidance-vms', windowMs: 60_000 },
        cdnMaxAgeSeconds: 30,
        freshForMs: 2 * 60_000,
        negativeForMs: 30_000,
        staleIfErrorForMs: 15 * 60_000,
        upstreamBudget: { limit: 720, scope: 'provider.its-road-guidance-vms', windowMs: 24 * 60 * 60_000 },
        upstreamBudgetCost: 1,
        upstreamTimeoutMs: 8_000,
      },
    ],
    [
      'SAFETY_NOTICE_ROUTE_PROFILE',
      {
        admissionRate: { limit: 60, scope: 'route.road-guidance-safety-notices', windowMs: 60_000 },
        cdnMaxAgeSeconds: 60,
        freshForMs: 5 * 60_000,
        negativeForMs: 60_000,
        staleIfErrorForMs: 30 * 60_000,
        upstreamBudget: {
          limit: 288,
          scope: 'provider.its-road-guidance-safety-notices',
          windowMs: 24 * 60 * 60_000,
        },
        upstreamBudgetCost: 1,
        upstreamTimeoutMs: 8_000,
      },
    ],
    [
      'VARIABLE_SPEED_LIMIT_ROUTE_PROFILE',
      {
        admissionRate: { limit: 60, scope: 'route.road-guidance-variable-speed-limits', windowMs: 60_000 },
        cdnMaxAgeSeconds: 60,
        freshForMs: 5 * 60_000,
        negativeForMs: 60_000,
        staleIfErrorForMs: 60 * 60_000,
        upstreamBudget: {
          limit: 288,
          scope: 'provider.its-road-guidance-variable-speed-limits',
          windowMs: 24 * 60 * 60_000,
        },
        upstreamBudgetCost: 1,
        upstreamTimeoutMs: 8_000,
      },
    ],
  ] as const)('keeps %s on its independent cache and resilience profile', (profileName, expected) => {
    expect(routeApi[profileName]).toMatchObject(expected);
  });

  it.each(Object.entries(fixtures))('returns value and empty snapshots for %s', async (factoryName, fixture) => {
    const createRoute = routeApi[factoryName] as CreateRoadGuidanceRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(envelope([fixture.item])))
      .mockResolvedValueOnce(jsonResponse(envelope([])));
    const route = createRoute({
      clock: () => now,
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject(`opaque-${fixture.channel}`),
      serviceKey: 'synthetic-its-secret',
    });

    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      data: { channel: fixture.channel, generatedAt: now, items: [expect.any(Object)] },
      fetchedAt: now,
      kind: 'value',
      source: expect.stringContaining('국가교통정보센터'),
    });
    await expect(route.load({}, new AbortController().signal)).resolves.toMatchObject({
      data: { channel: fixture.channel, generatedAt: now, items: [] },
      fetchedAt: now,
      kind: 'empty',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(Object.keys(fixtures))('fails before provider access when %s has no ITS credential', async (factoryName) => {
    const createRoute = routeApi[factoryName] as CreateRoadGuidanceRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const fetcher = vi.fn<typeof fetch>();
    const route = createRoute({
      fetcher,
      readAdmissionSubject: () => createAdmissionSubject('opaque-missing-road-guidance'),
    });

    await expect(route.load({}, new AbortController().signal)).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(Object.keys(fixtures))('preserves aborts and sanitizes provider failures for %s', async (factoryName) => {
    const createRoute = routeApi[factoryName] as CreateRoadGuidanceRoute | undefined;
    expect(createRoute).toBeTypeOf('function');
    if (createRoute === undefined) return;
    const aborted = new AbortController();
    aborted.abort(new DOMException('stop', 'AbortError'));
    const abortRoute = createRoute({
      fetcher: vi.fn<typeof fetch>(),
      readAdmissionSubject: () => createAdmissionSubject('opaque-abort-road-guidance'),
      serviceKey: 'synthetic-its-secret',
    });
    await expect(abortRoute.load({}, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });

    const failureRoute = createRoute({
      fetcher: vi.fn(async () => {
        throw new Error('raw-road-guidance-marker apiKey=synthetic-its-secret');
      }),
      readAdmissionSubject: () => createAdmissionSubject('opaque-failure-road-guidance'),
      serviceKey: 'synthetic-its-secret',
    });
    await expect(failureRoute.load({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});
