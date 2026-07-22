import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../..');
const runtimePublicApi = resolve(workspaceRoot, 'src/server/runtime/index.ts');
const vercelApiDirectory = resolve(workspaceRoot, 'api');
const vercelGatewayEntry = resolve(vercelApiDirectory, 'gateway.ts');

describe('server runtime boundaries', () => {
  it('exposes one runtime public API and one coarse Vercel function entry', () => {
    expect(existsSync(runtimePublicApi)).toBe(true);
    expect(existsSync(vercelGatewayEntry)).toBe(true);

    const apiEntries = existsSync(vercelApiDirectory)
      ? readdirSync(vercelApiDirectory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
          .map((entry) => entry.name)
      : [];

    expect(apiEntries).toEqual(['gateway.ts']);
  });

  it('publishes runtime configuration through the runtime public API', async () => {
    const runtime = (await import('../../src/server/runtime')) as Record<string, unknown>;

    expect(runtime.readFleetStateConfig).toEqual(expect.any(Function));
  });

  it('routes every API depth to the one coarse function without synthesizing query fields', () => {
    const config = JSON.parse(readFileSync(resolve(workspaceRoot, 'vercel.json'), 'utf8')) as {
      $schema?: unknown;
      framework?: unknown;
      functions?: unknown;
      regions?: unknown;
      rewrites?: unknown;
    };

    expect(config.$schema).toBe('https://openapi.vercel.sh/vercel.json');
    expect(config.framework).toBe('vite');
    expect(config.regions).toEqual(['hnd1']);
    expect(config.functions).toEqual({
      'api/*': { supportsCancellation: true },
    });
    expect(config.rewrites).toEqual([
      { source: '/healthz', destination: '/api/gateway' },
      { source: '/api', destination: '/api/gateway' },
      { source: '/api/(.*)', destination: '/api/gateway' },
      { source: '/((?!api(?:/|$)).*)', destination: '/index.html' },
    ]);
  });

  it('has no in-memory fleet-state fallback in the production runtime assembly', () => {
    const source = readFileSync(resolve(workspaceRoot, 'src/server/runtime/createGatewayRuntime.ts'), 'utf8');

    expect(source).not.toContain('MemoryFleetStateStore');
  });
});
