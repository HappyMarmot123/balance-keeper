import { describe, expect, it, vi } from 'vitest';

type RuntimeStub = Readonly<{
  getCdnMaxAgeSeconds(pathname: string): number | undefined;
  handle(request: Request): Promise<Response>;
}>;

const createRuntime = (response: () => Response) => {
  let capturedRequest: Request | undefined;
  const runtime: RuntimeStub = {
    getCdnMaxAgeSeconds: vi.fn(() => 60),
    handle: vi.fn(async (request) => {
      capturedRequest = request;
      return response();
    }),
  };

  return { getCapturedRequest: () => capturedRequest, runtime };
};

const currentResponse = (status: 200 | 304 = 200): Response =>
  new Response(status === 304 ? null : '{"data":true}', {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ETag: 'W/"fixture"',
    },
    status,
  });

describe('Vercel gateway adapter', () => {
  it('serves an isolated no-store health check without assembling the gateway', async () => {
    const runtimeModule = (await import('../../../src/server/runtime')) as Record<string, unknown>;

    expect(runtimeModule.handleVercelRequest).toEqual(expect.any(Function));

    const runtime: RuntimeStub = {
      getCdnMaxAgeSeconds: vi.fn(() => {
        throw new Error('health must not inspect route policy');
      }),
      handle: vi.fn(async () => {
        throw new Error('health must not call the gateway');
      }),
    };
    const response = await (
      runtimeModule.handleVercelRequest as (request: Request, runtime: RuntimeStub) => Promise<Response>
    )(new Request('https://balance.test/healthz?source=probe'), runtime);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(runtime.handle).not.toHaveBeenCalled();
    expect(runtime.getCdnMaxAgeSeconds).not.toHaveBeenCalled();
  });

  it('keeps health available when production credentials are misconfigured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

    try {
      const { handleVercelRequest } = await import('../../../src/server/runtime');
      const response = await handleVercelRequest(new Request('https://balance.test/healthz'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('preserves the original path and duplicate query order while replacing a spoofed subject', async () => {
    const runtimeModule = (await import('../../../src/server/runtime')) as Record<string, unknown>;
    const internalHeader = runtimeModule.TRUSTED_ADMISSION_SUBJECT_HEADER;

    expect(internalHeader).toBe('x-bk-admission-subject');

    const { getCapturedRequest, runtime } = createRuntime(() => new Response(null, { status: 404 }));
    const url = 'https://balance.test/api/weather?region=seoul&region=busan&z=1';
    await (runtimeModule.handleVercelRequest as (request: Request, runtime: RuntimeStub) => Promise<Response>)(
      new Request(url, {
        headers: {
          'x-bk-admission-subject': 'spoofed-subject',
          'x-forwarded-for': '198.51.100.99',
          'x-vercel-forwarded-for': '203.0.113.7',
        },
      }),
      runtime,
    );

    const forwarded = getCapturedRequest();
    expect(forwarded?.url).toBe(url);
    const subject = forwarded?.headers.get(String(internalHeader));
    expect(subject).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(subject).not.toBe('spoofed-subject');
    expect(subject).not.toContain('203.0.113.7');
    expect(subject).not.toContain('198.51.100.99');
  });

  it('uses one fail-closed anonymous subject for missing, invalid, or proxy-only identities', async () => {
    const runtimeModule = (await import('../../../src/server/runtime')) as Record<string, unknown>;
    const handle = runtimeModule.handleVercelRequest as (request: Request, runtime: RuntimeStub) => Promise<Response>;
    const internalHeader = String(runtimeModule.TRUSTED_ADMISSION_SUBJECT_HEADER);
    const requests = [
      new Request('https://balance.test/api/weather'),
      new Request('https://balance.test/api/weather', {
        headers: { 'x-vercel-forwarded-for': '203.0.113.7, 198.51.100.1' },
      }),
      new Request('https://balance.test/api/weather', {
        headers: { 'x-forwarded-for': '203.0.113.7' },
      }),
    ];
    const subjects: string[] = [];

    for (const request of requests) {
      const capture = createRuntime(() => new Response(null, { status: 404 }));
      await handle(request, capture.runtime);
      subjects.push(capture.getCapturedRequest()?.headers.get(internalHeader) ?? '');
    }

    expect(subjects[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(subjects)).toHaveProperty('size', 1);
  });

  it.each([200, 304] as const)('adds route TTL only to an exact current %s response', async (status) => {
    const { handleVercelRequest } = await import('../../../src/server/runtime');
    const { runtime } = createRuntime(() => currentResponse(status));

    const response = await handleVercelRequest(new Request('https://balance.test/api/weather?region=seoul'), runtime);

    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=60');
    expect(runtime.getCdnMaxAgeSeconds).toHaveBeenCalledWith('/api/weather');
  });

  it.each([
    {
      label: 'no-store response',
      request: new Request('https://balance.test/api/weather'),
      response: () =>
        new Response('{"error":true}', {
          headers: {
            'Cache-Control': 'no-store',
            'Vercel-CDN-Cache-Control': 'public, s-maxage=999',
          },
          status: 503,
        }),
    },
    {
      label: 'authorized request',
      request: new Request('https://balance.test/api/weather', {
        headers: { Authorization: 'Bearer secret' },
      }),
      response: () => currentResponse(),
    },
    {
      label: 'cookie-bearing request',
      request: new Request('https://balance.test/api/weather', {
        headers: { Cookie: 'session=secret' },
      }),
      response: () => currentResponse(),
    },
    {
      label: 'cookie-bearing response',
      request: new Request('https://balance.test/api/weather'),
      response: () => {
        const response = currentResponse();
        response.headers.set('Set-Cookie', 'session=secret');
        return response;
      },
    },
  ])('does not publish a CDN policy for a $label', async ({ request, response: createResponse }) => {
    const { handleVercelRequest } = await import('../../../src/server/runtime');
    const { runtime } = createRuntime(createResponse);

    const response = await handleVercelRequest(request, runtime);

    expect(response.headers.get('vercel-cdn-cache-control')).toBeNull();
  });
});
