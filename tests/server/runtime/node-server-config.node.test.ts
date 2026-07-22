import { describe, expect, it } from 'vitest';

describe('Node server configuration', () => {
  it('uses explicit container-safe defaults', async () => {
    const runtime = (await import('../../../src/server/runtime')) as Record<string, unknown>;
    expect(runtime.readNodeServerConfig).toEqual(expect.any(Function));

    const config = (runtime.readNodeServerConfig as (environment: Record<string, string | undefined>) => unknown)({});

    expect(config).toEqual({
      host: '0.0.0.0',
      origin: 'http://127.0.0.1:8787',
      port: 8_787,
      shutdownTimeoutMs: 10_000,
    });
  });

  it('accepts strict decimal overrides and derives origin from the port', async () => {
    const { readNodeServerConfig } = await import('../../../src/server/runtime');

    expect(
      readNodeServerConfig({
        BK_API_HOST: '127.0.0.1',
        BK_API_PORT: '9000',
        BK_SHUTDOWN_TIMEOUT_MS: '2500',
      }),
    ).toEqual({
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:9000',
      port: 9_000,
      shutdownTimeoutMs: 2_500,
    });
  });

  it('accepts a fixed public request origin without credentials or path state', async () => {
    const { readNodeServerConfig } = await import('../../../src/server/runtime');

    expect(readNodeServerConfig({ BK_API_ORIGIN: 'https://dashboard.example.com' })).toMatchObject({
      origin: 'https://dashboard.example.com',
    });
  });

  it.each([
    { BK_API_PORT: '0' },
    { BK_API_PORT: '65536' },
    { BK_API_PORT: '1e3' },
    { BK_SHUTDOWN_TIMEOUT_MS: '-1' },
    { BK_SHUTDOWN_TIMEOUT_MS: '0x10' },
    { BK_API_HOST: 'bad host' },
    { BK_API_ORIGIN: 'http://user@dashboard.example.com' },
    { BK_API_ORIGIN: 'https://dashboard.example.com/base' },
  ])('rejects an unsafe server configuration: %o', async (environment) => {
    const { readNodeServerConfig } = await import('../../../src/server/runtime');

    expect(() => readNodeServerConfig(environment)).toThrow();
  });
});
