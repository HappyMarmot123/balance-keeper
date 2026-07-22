import { request as createHttpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MemoryFleetStateStore } from '../../../src/server/cache';
import { createAdmissionSubject, createRouteProfile, type GatewayRoute } from '../../../src/server/gateway';
import { createGatewayRuntime, handleNodeGatewayRequest, handleVercelRequest } from '../../../src/server/runtime';
import { createNodeHttpServer } from '../../../src/server/runtime/nodeHttpAdapter';

const servers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

const fixtureSchema = z
  .object({
    empty: z.string(),
    tags: z.array(z.string()),
  })
  .strict();

type FixtureInput = z.infer<typeof fixtureSchema>;

const fixtureProfile = createRouteProfile({
  freshForMs: 1_000,
  staleIfErrorForMs: 5_000,
  negativeForMs: false,
  upstreamTimeoutMs: 750,
  lockWaitMs: 500,
  lockPollMs: 25,
  lockSafetyMs: 100,
  admissionRate: { limit: 30, windowMs: 60_000, scope: 'route.adapter-parity' },
  upstreamBudget: { limit: 10, windowMs: 60_000, scope: 'provider.adapter-parity' },
  breaker: {
    scope: 'provider.adapter-parity',
    failureThreshold: 3,
    failureWindowMs: 30_000,
    cooldownMs: 15_000,
    probeTimeoutMs: 2_000,
  },
  cdnMaxAgeSeconds: 60,
});

const createFixtureRuntime = () => {
  const now = 1_000;
  const route: GatewayRoute<FixtureInput, FixtureInput, typeof fixtureSchema> = {
    id: 'adapter-parity',
    path: '/api/adapter-parity',
    dataSchema: fixtureSchema,
    profile: fixtureProfile,
    parseRequest(request) {
      const search = new URL(request.url).searchParams;
      const input = {
        empty: search.get('empty') ?? 'missing',
        tags: search.getAll('tag'),
      };
      return {
        admissionSubject: createAdmissionSubject('opaque-adapter-parity'),
        input,
        publicCacheIdentity: input,
      };
    },
    async load(input) {
      return {
        data: input,
        fetchedAt: now,
        kind: 'value',
        source: 'adapter-parity-fixture',
      };
    },
  };

  return createGatewayRuntime({
    clock: () => now,
    createCoordinationToken: () => 'coordination-adapter-parity',
    createRequestId: () => 'request-adapter-parity',
    fleetStateStore: new MemoryFleetStateStore(() => now),
    routes: [route],
  });
};

type ResponseSnapshot = Readonly<{
  body: string;
  cacheControl: string | null;
  contentType: string | null;
  requestId: string | null;
  status: number;
}>;

const snapshotWebResponse = async (response: Response): Promise<ResponseSnapshot> => ({
  body: await response.text(),
  cacheControl: response.headers.get('cache-control'),
  contentType: response.headers.get('content-type'),
  requestId: response.headers.get('x-request-id'),
  status: response.status,
});

const requestNode = (port: number, path: string): Promise<ResponseSnapshot> =>
  new Promise((resolve, reject) => {
    const request = createHttpRequest({ host: '127.0.0.1', path, port }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          cacheControl:
            typeof response.headers['cache-control'] === 'string' ? response.headers['cache-control'] : null,
          contentType: typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : null,
          requestId: typeof response.headers['x-request-id'] === 'string' ? response.headers['x-request-id'] : null,
          status: response.statusCode ?? 0,
        });
      });
    });
    request.once('error', reject);
    request.end();
  });

describe('gateway runtime adapter parity', () => {
  it('preserves one duplicate-query fixture through direct, Vercel, and real Node loopback paths', async () => {
    const path = '/api/adapter-parity?tag=first&tag=second&empty=';
    const direct = await snapshotWebResponse(
      await createFixtureRuntime().handle(new Request(`https://balance.test${path}`)),
    );
    const vercelResponse = await handleVercelRequest(
      new Request(`https://balance.test${path}`, {
        headers: { 'x-vercel-forwarded-for': '203.0.113.7' },
      }),
      createFixtureRuntime(),
    );
    const vercel = await snapshotWebResponse(vercelResponse.clone());
    const nodeRuntime = createFixtureRuntime();
    const server = createNodeHttpServer({
      handleRequest: (request, context) => handleNodeGatewayRequest(request, context.remoteAddress, nodeRuntime),
      origin: 'http://127.0.0.1:8787',
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const node = await requestNode((server.address() as AddressInfo).port, path);

    expect(JSON.parse(direct.body)).toMatchObject({
      data: { empty: '', tags: ['first', 'second'] },
    });
    expect(vercel).toEqual(direct);
    expect(node).toEqual(direct);
    expect(vercelResponse.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=60');
  });
});
