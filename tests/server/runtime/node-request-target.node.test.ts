import { describe, expect, it } from 'vitest';

describe('safe Node request target', () => {
  it('preserves an origin-form path and duplicate query ordering under a fixed origin', async () => {
    const runtime = (await import('../../../src/server/runtime/nodeHttpAdapter')) as Record<string, unknown>;

    expect(runtime.createSafeNodeRequestUrl).toEqual(expect.any(Function));

    const url = (runtime.createSafeNodeRequestUrl as (origin: string, rawTarget: string | undefined) => URL)(
      'http://127.0.0.1:3000',
      '/api/weather?region=seoul&region=busan&z=1',
    );

    expect(url.href).toBe('http://127.0.0.1:3000/api/weather?region=seoul&region=busan&z=1');
  });

  it.each([
    undefined,
    '',
    '//evil.test/api/weather',
    'http://evil.test/api/weather',
    '/api\\weather',
    '/api/weather#fragment',
    '/api/%2e%2e/healthz',
    '/api/./weather',
    '/api/%zz/weather',
  ])('rejects a non-canonical raw target: %s', async (rawTarget) => {
    const { createSafeNodeRequestUrl } = await import('../../../src/server/runtime/nodeHttpAdapter');

    expect(() => createSafeNodeRequestUrl('http://127.0.0.1:3000', rawTarget)).toThrow(
      /canonical origin-form request target/,
    );
  });

  it.each([
    'ftp://127.0.0.1:3000',
    'http://user@127.0.0.1:3000',
    'http://127.0.0.1:3000/base',
    'http://127.0.0.1:3000?query=1',
  ])('rejects an unsafe configured origin: %s', async (origin) => {
    const { createSafeNodeRequestUrl } = await import('../../../src/server/runtime/nodeHttpAdapter');

    expect(() => createSafeNodeRequestUrl(origin, '/api/weather')).toThrow(/valid HTTP origin/);
  });
});
