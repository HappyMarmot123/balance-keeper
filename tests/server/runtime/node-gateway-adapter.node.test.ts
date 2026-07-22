import { describe, expect, it, vi } from 'vitest';

type RuntimeStub = Readonly<{
  getCdnMaxAgeSeconds(pathname: string): number | undefined;
  handle(request: Request): Promise<Response>;
}>;

describe('Node gateway adapter', () => {
  it('keeps health independent from production runtime configuration', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

    try {
      const runtime = (await import('../../../src/server/runtime')) as Record<string, unknown>;
      expect(runtime.handleNodeGatewayRequest).toEqual(expect.any(Function));

      const response = await (
        runtime.handleNodeGatewayRequest as (request: Request, remoteAddress: string | null) => Promise<Response>
      )(new Request('http://internal.balance.test/healthz'), '127.0.0.1');

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('replaces spoofed forwarding fields with a subject derived only from the socket', async () => {
    const runtimeModule = (await import('../../../src/server/runtime')) as Record<string, unknown>;
    let captured: Request | undefined;
    const runtime: RuntimeStub = {
      getCdnMaxAgeSeconds: () => undefined,
      handle: async (request) => {
        captured = request;
        return new Response(null, { status: 404 });
      },
    };
    const incoming = new Request('http://internal.balance.test/api/weather', {
      headers: {
        'x-bk-admission-subject': 'spoofed-subject',
        'x-forwarded-for': '203.0.113.9',
        'x-vercel-forwarded-for': '198.51.100.7',
      },
    });

    await (
      runtimeModule.handleNodeGatewayRequest as (
        request: Request,
        remoteAddress: string | null,
        runtime: RuntimeStub,
      ) => Promise<Response>
    )(incoming, '127.0.0.1', runtime);

    const subject = captured?.headers.get('x-bk-admission-subject');
    expect(subject).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(subject).not.toContain('spoofed-subject');
    expect(subject).not.toContain('203.0.113.9');
    expect(subject).not.toContain('198.51.100.7');
  });

  it('accepts an IPv6 socket identity without exposing it or collapsing it to anonymous', async () => {
    const { handleNodeGatewayRequest } = await import('../../../src/server/runtime');
    const subjects: string[] = [];
    const runtime: RuntimeStub = {
      getCdnMaxAgeSeconds: () => undefined,
      handle: async (request) => {
        subjects.push(request.headers.get('x-bk-admission-subject') ?? '');
        return new Response(null, { status: 404 });
      },
    };

    await handleNodeGatewayRequest(new Request('http://internal.balance.test/api/weather'), '2001:DB8::1', runtime);
    await handleNodeGatewayRequest(new Request('http://internal.balance.test/api/weather'), null, runtime);

    expect(subjects[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(subjects[0]).not.toContain('2001:db8::1');
    expect(subjects[0]).not.toBe(subjects[1]);
  });

  it('fails product requests closed without exposing a production configuration error', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

    try {
      const { handleNodeGatewayRequest } = await import('../../../src/server/runtime');
      const response = await handleNodeGatewayRequest(
        new Request('http://internal.balance.test/api/weather'),
        '127.0.0.1',
      );
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body).toContain('SERVICE_UNAVAILABLE');
      expect(body).not.toContain('configured together');
      expect(body).not.toContain('example.upstash.io');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
