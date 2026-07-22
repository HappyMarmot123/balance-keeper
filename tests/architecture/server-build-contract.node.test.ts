import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../..');

const localModuleSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier?.startsWith('.')) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
};

const resolveLocalModule = (importer: string, specifier: string): string | undefined => {
  const base = resolve(dirname(importer), specifier);
  const candidates =
    extname(base).length > 0
      ? [base]
      : [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')];
  return candidates.find(existsSync);
};

const collectLocalModuleGraph = (entry: string): Map<string, string> => {
  const graph = new Map<string, string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || graph.has(file)) {
      continue;
    }

    const source = readFileSync(file, 'utf8');
    graph.set(file, source);
    for (const specifier of localModuleSpecifiers(source)) {
      const dependency = resolveLocalModule(file, specifier);
      if (dependency !== undefined) {
        pending.push(dependency);
      }
    }
  }
  return graph;
};

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

  it('keeps the browser query runtime outside the bundled server dependency graph', () => {
    const graph = collectLocalModuleGraph(resolve(workspaceRoot, 'src/server/runtime/nodeMain.ts'));
    const contractEntry = resolve(workspaceRoot, 'src/entities/weather/contract.ts');
    const browserBarrel = resolve(workspaceRoot, 'src/entities/weather/index.ts');
    const browserQueryDependencies = [...graph.entries()]
      .filter(([, source]) => source.includes('@tanstack') || source.includes('QueryClient'))
      .map(([file]) => file.replaceAll('\\', '/').replace(`${workspaceRoot.replaceAll('\\', '/')}/`, ''));

    expect(graph.has(contractEntry)).toBe(true);
    expect(graph.has(browserBarrel)).toBe(false);
    expect(browserQueryDependencies).toEqual([]);
  });
});
