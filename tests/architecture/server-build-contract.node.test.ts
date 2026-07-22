import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../..');

describe('server build contract', () => {
  it('defines an explicit bundled Node entry and lifecycle scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(existsSync(resolve(workspaceRoot, 'src/server/runtime/nodeMain.ts'))).toBe(true);
    expect(existsSync(resolve(workspaceRoot, 'vite.server.config.ts'))).toBe(true);
    expect(packageJson.scripts).toMatchObject({
      build: 'npm run typecheck && npm run build:client && npm run build:server',
      'build:client': 'vite build',
      'build:server': 'vite build --config vite.server.config.ts',
      'start:api': 'node dist-server/server.mjs',
    });
  });

  it('typechecks the server config and excludes generated server output', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(workspaceRoot, 'tsconfig.json'), 'utf8')) as {
      include?: string[];
    };
    const gitignore = readFileSync(resolve(workspaceRoot, '.gitignore'), 'utf8');

    expect(tsconfig.include).toContain('vite.server.config.ts');
    expect(gitignore.split(/\r?\n/)).toContain('dist-server/');
  });

  it('keeps local dev and preview API requests on the same browser origin', async () => {
    const viteConfig = (await import('../../vite.config')).default as {
      preview?: { proxy?: unknown };
      server?: { proxy?: unknown };
    };
    const expectedProxy = {
      '^/api(?:/|\\?|$)': { changeOrigin: false, target: 'http://127.0.0.1:8787' },
      '^/healthz(?:\\?|$)': { changeOrigin: false, target: 'http://127.0.0.1:8787' },
    };

    expect(viteConfig.server?.proxy).toEqual(expectedProxy);
    expect(viteConfig.preview?.proxy).toEqual(expectedProxy);

    const contexts = Object.keys(expectedProxy).map((context) => new RegExp(context));
    expect(contexts.some((context) => context.test('/api'))).toBe(true);
    expect(contexts.some((context) => context.test('/api?region=seoul'))).toBe(true);
    expect(contexts.some((context) => context.test('/api/weather'))).toBe(true);
    expect(contexts.some((context) => context.test('/healthz'))).toBe(true);
    expect(contexts.some((context) => context.test('/healthz?source=probe'))).toBe(true);
    expect(contexts.some((context) => context.test('/apiary'))).toBe(false);
    expect(contexts.some((context) => context.test('/healthzfoo'))).toBe(false);
  });
});
