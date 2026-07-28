// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createAdmissionSubject } from '../../../src/server/gateway';
import * as routeModule from '../../../src/server/routes/earthquake';

const earthquakeRoute = routeModule as Record<string, unknown>;
type KmaRouteFixture = {
  response: { body: { items: unknown; totalCount: number } };
};
type UsgsRouteFixture = {
  features: unknown[];
  metadata: { count: number };
};
const kmaFixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../fixtures/kma/earthquake-success.json'), 'utf8'),
) as KmaRouteFixture;
const usgsFixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../fixtures/usgs/earthquake-success.json'), 'utf8'),
) as UsgsRouteFixture;
const NOW = Date.parse('2026-07-28T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

const createFixtureFetcher = (options: { failKma?: boolean; failUsgs?: boolean } = {}) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
    if (url.hostname === 'apis.data.go.kr') {
      return options.failKma ? new Response(null, { status: 503 }) : Response.json(kmaFixture);
    }
    if (url.hostname === 'earthquake.usgs.gov') {
      return options.failUsgs ? new Response(null, { status: 503 }) : Response.json(usgsFixture);
    }
    return new Response(null, { status: 404 });
  });

const createRoute = (options: { fetcher?: typeof fetch; serviceKey?: string } = {}) => {
  const factory = earthquakeRoute.createEarthquakeRoute;
  expect(factory).toBeTypeOf('function');
  if (typeof factory !== 'function') {
    throw new TypeError('createEarthquakeRoute is required');
  }

  return factory({
    clock: () => NOW,
    fetcher: options.fetcher,
    readAdmissionSubject: () => createAdmissionSubject('opaque-earthquake-fixture'),
    serviceKey: options.serviceKey,
  });
};

describe('/api/earthquake request contract', () => {
  it('owns one fixed public cache identity without user-controlled dimensions', async () => {
    const route = createRoute();

    await expect(
      Promise.resolve(route.parseRequest(new Request('https://balance.test/api/earthquake'))),
    ).resolves.toEqual({
      admissionSubject: 'opaque-earthquake-fixture',
      input: {},
      publicCacheIdentity: { scope: 'east-asia-recent' },
    });
  });

  it.each(['/api/earthquake?from=20260701', '/api/earthquake?debug=true', '/api/earthquake?unused='])(
    'rejects every query parameter: %s',
    async (path) => {
      const route = createRoute();

      await expect(
        Promise.resolve().then(() => route.parseRequest(new Request(`https://balance.test${path}`))),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    },
  );
});

describe('earthquake route loader', () => {
  it('combines KMA and USGS with explicit source windows and native provenance', async () => {
    const fetcher = createFixtureFetcher();
    const route = createRoute({ fetcher, serviceKey: 'synthetic-earthquake-key' });
    const parsed = route.parseRequest(new Request('https://balance.test/api/earthquake'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toMatchObject({
      kind: 'value',
      data: {
        coverage: {
          maximumLatitude: 45,
          maximumLongitude: 145,
          minimumLatitude: 21,
          minimumLongitude: 110,
        },
        events: [
          {
            id: 'kma:108:202607:42',
            magnitude: 3.1,
            sourceRefs: [{ provider: 'KMA' }, { provider: 'USGS' }],
          },
          {
            id: 'usgs:us-test-2',
            magnitude: null,
            sourceRefs: [{ provider: 'USGS' }],
          },
        ],
        sources: {
          kma: { from: NOW - 3 * DAY_MS, status: 'available', to: NOW },
          usgs: { from: NOW - 7 * DAY_MS, status: 'available', to: NOW },
        },
        window: { from: NOW - 7 * DAY_MS, to: NOW },
      },
      fetchedAt: NOW,
      source: 'KMA+USGS',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps USGS data available when the KMA credential is missing', async () => {
    const fetcher = createFixtureFetcher();
    const route = createRoute({ fetcher });
    const parsed = route.parseRequest(new Request('https://balance.test/api/earthquake'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toMatchObject({
      kind: 'value',
      data: {
        events: [{ id: 'usgs:us-test-1' }, { id: 'usgs:us-test-2' }],
        sources: {
          kma: { status: 'missing-credential' },
          usgs: { status: 'available' },
        },
      },
      source: 'USGS',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['KMA', { failKma: true }, 'USGS', { kma: 'unavailable', usgs: 'available' }],
    ['USGS', { failUsgs: true }, 'KMA', { kma: 'available', usgs: 'unavailable' }],
  ] as const)('returns a positive partial snapshot when %s fails', async (_label, failures, source, statuses) => {
    const route = createRoute({
      fetcher: createFixtureFetcher(failures),
      serviceKey: 'synthetic-earthquake-key',
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/earthquake'));
    const outcome = await route.load(parsed.input, new AbortController().signal);

    expect(outcome.kind).toBe('value');
    expect(outcome.source).toBe(source);
    expect(outcome.data.sources.kma.status).toBe(statuses.kma);
    expect(outcome.data.sources.usgs.status).toBe(statuses.usgs);
    expect(outcome.data.events.length).toBeGreaterThan(0);
  });

  it('uses an empty outcome only when both available sources are successfully empty', async () => {
    const emptyKma = structuredClone(kmaFixture);
    emptyKma.response.body.items = '';
    emptyKma.response.body.totalCount = 0;
    const emptyUsgs = structuredClone(usgsFixture);
    emptyUsgs.features = [];
    emptyUsgs.metadata.count = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
      return Response.json(url.hostname === 'apis.data.go.kr' ? emptyKma : emptyUsgs);
    });
    const route = createRoute({ fetcher, serviceKey: 'synthetic-earthquake-key' });
    const parsed = route.parseRequest(new Request('https://balance.test/api/earthquake'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toMatchObject({
      kind: 'empty',
      data: {
        events: [],
        sources: {
          kma: { status: 'available' },
          usgs: { status: 'available' },
        },
      },
      source: 'KMA+USGS',
    });
  });

  it('keeps an empty successful source positive when the other source fails', async () => {
    const emptyUsgs = structuredClone(usgsFixture);
    emptyUsgs.features = [];
    emptyUsgs.metadata.count = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
      return url.hostname === 'apis.data.go.kr' ? new Response(null, { status: 503 }) : Response.json(emptyUsgs);
    });
    const route = createRoute({ fetcher, serviceKey: 'synthetic-earthquake-key' });
    const parsed = route.parseRequest(new Request('https://balance.test/api/earthquake'));

    await expect(route.load(parsed.input, new AbortController().signal)).resolves.toMatchObject({
      kind: 'value',
      data: {
        events: [],
        sources: {
          kma: { status: 'unavailable' },
          usgs: { status: 'available' },
        },
      },
      source: 'USGS',
    });
  });

  it('deterministically limits a valid high-volume feed to the public 500-event bound', async () => {
    const bulkUsgs = structuredClone(usgsFixture);
    const seed = bulkUsgs.features[0] as
      | {
          geometry: { coordinates: number[]; type: string };
          id: string;
          properties: {
            ids: string;
            mag: number | null;
            magType: string | null;
            place: string | null;
            time: number;
            type: string;
            updated: number;
          };
          type: string;
        }
      | undefined;
    if (seed === undefined) {
      throw new TypeError('Synthetic USGS fixture requires one feature');
    }
    bulkUsgs.features = Array.from({ length: 501 }, (_, index) => {
      const id = `us-bulk-${String(index).padStart(3, '0')}`;
      const occurredAt = NOW - (index + 1) * 60_000;
      return {
        ...seed,
        id,
        properties: {
          ...seed.properties,
          ids: `,${id},`,
          time: occurredAt,
          updated: occurredAt + 1_000,
        },
      };
    });
    bulkUsgs.metadata.count = bulkUsgs.features.length;
    const fetcher = vi.fn(async () => Response.json(bulkUsgs));
    const route = createRoute({ fetcher });
    const parsed = route.parseRequest(new Request('https://balance.test/api/earthquake'));

    const outcome = await route.load(parsed.input, new AbortController().signal);

    expect(outcome.data.events).toHaveLength(500);
    expect(outcome.data.events[0]?.id).toBe('usgs:us-bulk-000');
    expect(outcome.data.events.at(-1)?.id).toBe('usgs:us-bulk-499');
  });

  it('fails safely only when no source succeeds', async () => {
    const route = createRoute({
      fetcher: createFixtureFetcher({ failKma: true, failUsgs: true }),
      serviceKey: 'synthetic-earthquake-key',
    });
    const parsed = route.parseRequest(new Request('https://balance.test/api/earthquake'));

    await expect(route.load(parsed.input, new AbortController().signal)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('preserves a caller abort instead of degrading it to partial data', async () => {
    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    controller.abort(reason);
    const fetcher = createFixtureFetcher();
    const route = createRoute({ fetcher, serviceKey: 'synthetic-earthquake-key' });
    const parsed = route.parseRequest(new Request('https://balance.test/api/earthquake'));

    await expect(route.load(parsed.input, controller.signal)).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('earthquake route profile', () => {
  it('freezes the one-minute origin profile and bounded provider budget', () => {
    const route = createRoute();
    const profile = earthquakeRoute.EARTHQUAKE_ROUTE_PROFILE;

    expect(profile).toEqual({
      admissionRate: { limit: 60, scope: 'route.earthquake', windowMs: 60_000 },
      breaker: {
        cooldownMs: 30_000,
        failureThreshold: 3,
        failureWindowMs: 60_000,
        probeTimeoutMs: 5_000,
        scope: 'provider.earthquake',
      },
      cdnMaxAgeSeconds: 30,
      freshForMs: 60_000,
      lockPollMs: 50,
      lockSafetyMs: 1_000,
      lockWaitMs: 2_000,
      negativeForMs: 60_000,
      staleIfErrorForMs: 60 * 60_000,
      upstreamBudget: { limit: 1_440, scope: 'provider.earthquake', windowMs: 24 * 60 * 60_000 },
      upstreamTimeoutMs: 8_000,
    });
    expect(route.profile).toBe(profile);
    expect(Object.isFrozen(profile)).toBe(true);
  });
});
