import { EventEmitter } from 'node:events';
import { request as createHttpRequest } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

const get = (port: number, path: string): Promise<Readonly<{ body: string; status: number }>> =>
  new Promise((resolve, reject) => {
    const request = createHttpRequest({ host: '127.0.0.1', path, port }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          status: response.statusCode ?? 0,
        }),
      );
    });
    request.once('error', reject);
    request.end();
  });

describe('production Node server', () => {
  it('starts the real bridge and serves health without a gateway dependency', async () => {
    const module = (await import('../../../src/server/runtime/nodeServer')) as Record<string, unknown>;
    expect(module.startProductionNodeServer).toEqual(expect.any(Function));

    const running = await (
      module.startProductionNodeServer as (options: unknown) => Promise<{
        close(): Promise<void>;
        port: number;
      }>
    )({
      config: {
        host: '127.0.0.1',
        origin: 'http://127.0.0.1:8787',
        port: 0,
        shutdownTimeoutMs: 100,
      },
    });

    try {
      const response = await get(running.port, '/healthz?source=docker');
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
    } finally {
      await running.close();
    }
  });

  it('starts shutdown only once across repeated termination signals', async () => {
    const { installNodeShutdownHandlers } = await import('../../../src/server/runtime/nodeServer');
    const signals = new EventEmitter();
    const shutdown = vi.fn(async () => undefined);
    const onError = vi.fn();
    const dispose = installNodeShutdownHandlers(shutdown, signals, onError);

    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    dispose();
    signals.emit('SIGTERM');
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('reports a shutdown rejection without starting a second shutdown', async () => {
    const { installNodeShutdownHandlers } = await import('../../../src/server/runtime/nodeServer');
    const signals = new EventEmitter();
    const failure = new Error('shutdown failed');
    const shutdown = vi.fn(async () => {
      throw failure;
    });
    const onError = vi.fn();
    installNodeShutdownHandlers(shutdown, signals, onError);

    signals.emit('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));

    expect(shutdown).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
