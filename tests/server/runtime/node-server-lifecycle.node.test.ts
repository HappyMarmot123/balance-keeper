import { request as createHttpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';

const request = (port: number, path = '/healthz'): Promise<string> =>
  new Promise((resolve, reject) => {
    const outgoing = createHttpRequest({ host: '127.0.0.1', path, port }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    outgoing.once('error', reject);
    outgoing.end();
  });

describe('Node HTTP server lifecycle', () => {
  it('stops accepting connections, drains an active request, and reuses one shutdown promise', async () => {
    const module = (await import('../../../src/server/runtime/nodeHttpAdapter')) as Record<string, unknown>;
    expect(module.startNodeHttpServer).toEqual(expect.any(Function));

    let releaseRequest!: () => void;
    let observeRequest!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      observeRequest = resolve;
    });
    const requestReleased = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const running = await (
      module.startNodeHttpServer as (options: unknown) => Promise<{
        close(): Promise<void>;
        port: number;
      }>
    )({
      handleRequest: async () => {
        observeRequest();
        await requestReleased;
        return new Response('drained');
      },
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:8787',
      port: 0,
      shutdownTimeoutMs: 1_000,
    });
    const activeResponse = request(running.port, '/api/slow');
    await requestStarted;

    const firstClose = running.close();
    const secondClose = running.close();
    const closeStartedAt = Date.now();
    expect(secondClose).toBe(firstClose);

    releaseRequest();
    await expect(activeResponse).resolves.toBe('drained');
    await expect(firstClose).resolves.toBeUndefined();
    expect(Date.now() - closeStartedAt).toBeLessThan(500);
    await expect(request(running.port)).rejects.toBeDefined();
  });

  it('force-closes active connections at the shutdown deadline', async () => {
    const { startNodeHttpServer } = await import('../../../src/server/runtime/nodeHttpAdapter');
    let releaseRequest!: () => void;
    let observeRequest!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      observeRequest = resolve;
    });
    const requestReleased = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const running = await startNodeHttpServer({
      handleRequest: async () => {
        observeRequest();
        await requestReleased;
        return new Response('too-late');
      },
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:8787',
      port: 0,
      shutdownTimeoutMs: 25,
    });
    const activeResponse = request(running.port, '/api/hung');
    activeResponse.catch(() => undefined);
    await requestStarted;

    await expect(running.close()).resolves.toBeUndefined();
    await expect(activeResponse).rejects.toBeDefined();
    releaseRequest();
  });

  it('rejects a port collision without leaving a second listener behind', async () => {
    const { startNodeHttpServer } = await import('../../../src/server/runtime/nodeHttpAdapter');
    const first = await startNodeHttpServer({
      handleRequest: async () => new Response('first'),
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:8787',
      port: 0,
      shutdownTimeoutMs: 100,
    });

    await expect(
      startNodeHttpServer({
        handleRequest: async () => new Response('second'),
        host: '127.0.0.1',
        origin: 'http://127.0.0.1:8787',
        port: first.port,
        shutdownTimeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });

    await first.close();
  });
});
