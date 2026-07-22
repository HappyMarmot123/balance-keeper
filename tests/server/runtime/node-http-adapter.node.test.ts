import { request as createHttpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorEnvelopeSchema } from '../../../src/shared/contracts';

type NodeHandler = (request: Request, context: Readonly<{ remoteAddress: string | null }>) => Promise<Response>;

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

const startServer = async (handleRequest: NodeHandler) => {
  const module = (await import('../../../src/server/runtime/nodeHttpAdapter')) as Record<string, unknown>;
  expect(module.createNodeHttpServer).toEqual(expect.any(Function));

  const server = (
    module.createNodeHttpServer as (options: { origin: string; handleRequest: NodeHandler }) => HttpServer
  )({ origin: 'https://internal.balance.test', handleRequest });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return (server.address() as AddressInfo).port;
};

const sendRequest = (
  port: number,
  options: Readonly<{
    headers?: Record<string, string | string[]>;
    method?: string;
    path: string;
  }>,
): Promise<Readonly<{ body: string; headers: import('node:http').IncomingHttpHeaders; status: number }>> =>
  new Promise((resolve, reject) => {
    const request = createHttpRequest(
      {
        headers: options.headers,
        host: '127.0.0.1',
        method: options.method ?? 'GET',
        path: options.path,
        port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once('error', reject);
    request.end();
  });

describe('Node HTTP adapter', () => {
  it('uses the fixed origin, preserves query semantics, and exposes only the socket identity', async () => {
    let captured: { context: Readonly<{ remoteAddress: string | null }>; request: Request } | undefined;
    const port = await startServer(async (request, context) => {
      captured = { context, request };
      return new Response('ok');
    });

    const response = await sendRequest(port, {
      headers: {
        Connection: 'keep-alive, x-hop',
        Host: 'evil.example',
        'Proxy-Authorization': 'Basic must-not-forward',
        'X-Forwarded-For': '203.0.113.9',
        'X-Forwarded-Host': 'evil.example',
        'X-Forwarded-Port': '443',
        'X-Forwarded-Proto': 'https',
        'X-Hop': 'must-not-forward',
        'X-Vercel-Forwarded-For': '198.51.100.7',
      },
      path: '/api/weather?tag=a&tag=b&empty=',
    });

    expect(response.status).toBe(200);
    expect(captured?.request.url).toBe('https://internal.balance.test/api/weather?tag=a&tag=b&empty=');
    expect(captured?.context.remoteAddress).toMatch(/127\.0\.0\.1$/);
    expect(captured?.context.remoteAddress).not.toBe('203.0.113.9');
    expect(captured?.request.headers.get('connection')).toBeNull();
    expect(captured?.request.headers.get('host')).toBeNull();
    expect(captured?.request.headers.get('proxy-authorization')).toBeNull();
    expect(captured?.request.headers.get('x-hop')).toBeNull();
    expect(captured?.request.headers.get('x-forwarded-for')).toBeNull();
    expect(captured?.request.headers.get('x-forwarded-host')).toBeNull();
    expect(captured?.request.headers.get('x-forwarded-port')).toBeNull();
    expect(captured?.request.headers.get('x-forwarded-proto')).toBeNull();
    expect(captured?.request.headers.get('x-vercel-forwarded-for')).toBeNull();
  });

  it('strips proxy-only response authentication headers', async () => {
    const port = await startServer(
      async () =>
        new Response('ok', {
          headers: {
            'Proxy-Authenticate': 'Basic realm="must-not-forward"',
            'Proxy-Authentication-Info': 'nextnonce="must-not-forward"',
          },
        }),
    );

    const response = await sendRequest(port, { path: '/api/proxy-auth' });

    expect(response.status).toBe(200);
    expect(response.headers['proxy-authenticate']).toBeUndefined();
    expect(response.headers['proxy-authentication-info']).toBeUndefined();
  });

  it('streams request bytes to the handler before the client ends the request', async () => {
    let observeFirstChunk!: (value: string) => void;
    const firstChunk = new Promise<string>((resolve) => {
      observeFirstChunk = resolve;
    });
    const port = await startServer(async (request) => {
      const reader = request.body?.getReader();
      const decoder = new TextDecoder();
      const first = await reader?.read();
      observeFirstChunk(decoder.decode(first?.value));
      const second = await reader?.read();
      return new Response(`${decoder.decode(first?.value)}${decoder.decode(second?.value)}`);
    });

    const response = new Promise<string>((resolve, reject) => {
      const request = createHttpRequest(
        { host: '127.0.0.1', method: 'POST', path: '/api/stream', port },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        },
      );
      request.once('error', reject);
      request.write('first');

      void firstChunk.then(() => request.end('second'));
    });

    await expect(firstChunk).resolves.toBe('first');
    await expect(response).resolves.toBe('firstsecond');
  });

  it('preserves multiple Set-Cookie fields and streams the response body', async () => {
    const port = await startServer(async () => {
      const headers = new Headers();
      headers.append('Set-Cookie', 'first=1; Path=/; HttpOnly');
      headers.append('Set-Cookie', 'second=2; Path=/; Secure');
      return new Response('streamed-body', { headers });
    });

    const response = await sendRequest(port, { path: '/api/cookies' });

    expect(response.status).toBe(200);
    expect(response.body).toBe('streamed-body');
    expect(response.headers['set-cookie']).toEqual(['first=1; Path=/; HttpOnly', 'second=2; Path=/; Secure']);
  });

  it('preserves duplicate end-to-end request header values', async () => {
    let capturedHeader: string | null = null;
    const port = await startServer(async (request) => {
      capturedHeader = request.headers.get('x-fixture-tag');
      return new Response(null, { status: 204 });
    });

    const response = await sendRequest(port, {
      headers: { 'X-Fixture-Tag': ['first', 'second'] },
      path: '/api/duplicate-headers',
    });

    expect(response.status).toBe(204);
    expect(capturedHeader).toBe('first, second');
  });

  it('cancels a handler body for HEAD and sends no bytes', async () => {
    const cancel = vi.fn();
    const port = await startServer(
      async () =>
        new Response(
          new ReadableStream({
            cancel,
            pull(controller) {
              controller.enqueue(new TextEncoder().encode('must-not-send'));
            },
          }),
        ),
    );

    const response = await sendRequest(port, { method: 'HEAD', path: '/api/head' });

    expect(response.status).toBe(200);
    expect(response.body).toBe('');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([204, 205, 304] as const)('sends no response bytes for bodyless status %s', async (status) => {
    const port = await startServer(
      async () =>
        new Response(null, {
          headers: { 'X-Fixture-Status': String(status) },
          status,
        }),
    );

    const response = await sendRequest(port, { path: `/api/bodyless-${status}` });

    expect(response.status).toBe(status);
    expect(response.body).toBe('');
    expect(response.headers['x-fixture-status']).toBe(String(status));
  });

  it('rejects a normalized raw target before invoking the handler', async () => {
    const handler = vi.fn<NodeHandler>(async () => new Response('unsafe'));
    const port = await startServer(handler);

    const response = await sendRequest(port, { path: '/api/%2e%2e/healthz' });

    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    const envelope = errorEnvelopeSchema.parse(JSON.parse(response.body));
    expect(response.headers['x-request-id']).toBe(envelope.error.requestId);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a generic no-store 500 when the handler rejects before headers', async () => {
    const port = await startServer(async () => {
      throw new Error('sensitive failure detail');
    });

    const response = await sendRequest(port, { path: '/api/failure' });

    expect(response.status).toBe(500);
    expect(response.headers['cache-control']).toBe('no-store');
    const envelope = errorEnvelopeSchema.parse(JSON.parse(response.body));
    expect(response.headers['x-request-id']).toBe(envelope.error.requestId);
    expect(response.body).toContain('INTERNAL');
    expect(response.body).not.toContain('sensitive failure detail');
  });

  it('aborts the Web Request when the client disconnects', async () => {
    let observeStart!: () => void;
    let observeAbort!: () => void;
    const started = new Promise<void>((resolve) => {
      observeStart = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      observeAbort = resolve;
    });
    const port = await startServer(async (request) => {
      observeStart();
      await new Promise<void>((resolve) => {
        request.signal.addEventListener(
          'abort',
          () => {
            observeAbort();
            resolve();
          },
          { once: true },
        );
      });
      return new Response(null, { status: 204 });
    });
    const client = createHttpRequest({
      host: '127.0.0.1',
      method: 'POST',
      path: '/api/disconnect',
      port,
    });
    client.on('error', () => undefined);
    client.write('partial');
    await started;
    client.destroy();

    await expect(aborted).resolves.toBeUndefined();
  });

  it('rejects an in-progress Web request body when the client disconnects', async () => {
    let observeStart!: () => void;
    let observeFailure!: (value: Readonly<{ aborted: boolean; error: unknown }>) => void;
    const started = new Promise<void>((resolve) => {
      observeStart = resolve;
    });
    const failed = new Promise<Readonly<{ aborted: boolean; error: unknown }>>((resolve) => {
      observeFailure = resolve;
    });
    const port = await startServer(async (request) => {
      observeStart();
      try {
        await request.text();
      } catch (error) {
        observeFailure({ aborted: request.signal.aborted, error });
      }
      return new Response(null, { status: 204 });
    });
    const client = createHttpRequest({
      host: '127.0.0.1',
      method: 'POST',
      path: '/api/request-stream-error',
      port,
    });
    client.on('error', () => undefined);
    client.write('partial');
    await started;
    client.destroy();

    const result = await failed;
    expect(result.aborted).toBe(true);
    expect(result.error).toBeDefined();
  });

  it('destroys a partial response after a stream failure without writing a second envelope', async () => {
    const port = await startServer(async (request) => {
      if (new URL(request.url).pathname === '/api/recovered') {
        return new Response('recovered');
      }

      let pullCount = 0;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            pullCount += 1;
            if (pullCount === 1) {
              controller.enqueue(new TextEncoder().encode('partial'));
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
            controller.error(new Error('response stream failed'));
          },
        }),
      );
    });

    const partial = await new Promise<Readonly<{ body: string; status: number }>>((resolve, reject) => {
      const client = createHttpRequest({ host: '127.0.0.1', path: '/api/response-stream-error', port }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('aborted', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: response.statusCode ?? 0,
          });
        });
        response.once('end', () => reject(new Error('partial response unexpectedly completed')));
      });
      client.once('error', reject);
      client.end();
    });

    expect(partial.status).toBe(200);
    expect(partial.body).toBe('partial');
    expect(partial.body).not.toContain('INTERNAL');
    await expect(sendRequest(port, { path: '/api/recovered' })).resolves.toMatchObject({
      body: 'recovered',
      status: 200,
    });
  });

  it('applies backpressure instead of draining an entire large response into memory', async () => {
    const chunk = new Uint8Array(64 * 1_024);
    const totalChunks = 256;
    let pullCount = 0;
    let observeCancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      observeCancel = resolve;
    });
    const port = await startServer(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              observeCancel();
            },
            pull(controller) {
              pullCount += 1;
              controller.enqueue(chunk);
              if (pullCount === totalChunks) {
                controller.close();
              }
            },
          }),
        ),
    );

    const client = createHttpRequest({ host: '127.0.0.1', path: '/api/backpressure', port });
    client.on('error', () => undefined);
    const firstChunk = new Promise<void>((resolve) => {
      client.on('response', (response) => {
        response.once('data', () => {
          response.pause();
          resolve();
        });
      });
    });
    client.end();
    await firstChunk;
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(pullCount).toBeGreaterThan(0);
    expect(pullCount).toBeLessThan(totalChunks);
    client.destroy();
    await expect(cancelled).resolves.toBeUndefined();
  });
});
