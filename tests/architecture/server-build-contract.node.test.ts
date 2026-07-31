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
      'build:server:dev': 'vite build --config vite.local-server.config.ts',
      dev: 'node scripts/dev.mjs',
      'dev:web': 'vite --strictPort',
      'start:api': 'node dist-server/server.mjs',
    });
  });

  it('keeps the local memory runtime in a separate development server bundle', async () => {
    const localEntry = resolve(workspaceRoot, 'src/server/runtime/nodeDevMain.ts');
    const localConfigPath = resolve(workspaceRoot, 'vite.local-server.config.ts');
    const localRunner = resolve(workspaceRoot, 'scripts/dev.mjs');

    expect(existsSync(localEntry)).toBe(true);
    expect(existsSync(localConfigPath)).toBe(true);
    expect(existsSync(localRunner)).toBe(true);
    if (!existsSync(localEntry) || !existsSync(localConfigPath)) {
      return;
    }

    const localConfig = (await import('../../vite.local-server.config')).default as {
      build?: { outDir?: string; ssr?: string };
    };
    expect(localConfig.build).toMatchObject({
      outDir: 'dist-server-dev',
      ssr: 'src/server/runtime/nodeDevMain.ts',
    });

    const productionGraph = collectLocalModuleGraph(resolve(workspaceRoot, 'src/server/runtime/nodeMain.ts'));
    const vercelGraph = collectLocalModuleGraph(resolve(workspaceRoot, 'api/gateway.ts'));
    const localGraph = collectLocalModuleGraph(localEntry);
    const memoryStorePath = resolve(workspaceRoot, 'src/server/cache/fleetStateStore.ts');
    const localRuntimePath = resolve(workspaceRoot, 'src/server/runtime/localDevelopmentRuntime.ts');

    expect(productionGraph.has(localRuntimePath)).toBe(false);
    expect(vercelGraph.has(localRuntimePath)).toBe(false);
    expect([...vercelGraph.values()].some((source) => source.includes('new MemoryFleetStateStore'))).toBe(false);
    expect(localGraph.has(memoryStorePath)).toBe(true);
    expect(localGraph.has(localRuntimePath)).toBe(true);
    expect([...localGraph.values()].some((source) => source.includes('new MemoryFleetStateStore'))).toBe(true);
  });

  it('typechecks the server config and excludes generated server output', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(workspaceRoot, 'tsconfig.json'), 'utf8')) as {
      include?: string[];
    };
    const gitignore = readFileSync(resolve(workspaceRoot, '.gitignore'), 'utf8');

    expect(tsconfig.include).toContain('vite.server.config.ts');
    expect(tsconfig.include).toContain('vite.local-server.config.ts');
    expect(gitignore.split(/\r?\n/)).toContain('dist-server/');
    expect(gitignore.split(/\r?\n/)).toContain('dist-server-dev/');
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
    const contractEntries = [
      resolve(workspaceRoot, 'src/entities/air-quality/contract.ts'),
      resolve(workspaceRoot, 'src/entities/cctv/contract.ts'),
      resolve(workspaceRoot, 'src/entities/earthquake/contract.ts'),
      resolve(workspaceRoot, 'src/entities/macro/contract.ts'),
      resolve(workspaceRoot, 'src/entities/weather/contract.ts'),
      resolve(workspaceRoot, 'src/entities/weather-alert/contract.ts'),
    ];
    const browserBarrels = [
      resolve(workspaceRoot, 'src/entities/air-quality/index.ts'),
      resolve(workspaceRoot, 'src/entities/cctv/index.ts'),
      resolve(workspaceRoot, 'src/entities/earthquake/index.ts'),
      resolve(workspaceRoot, 'src/entities/macro/index.ts'),
      resolve(workspaceRoot, 'src/entities/weather/index.ts'),
      resolve(workspaceRoot, 'src/entities/weather-alert/index.ts'),
    ];
    const browserQueryDependencies = [...graph.entries()]
      .filter(([, source]) => source.includes('@tanstack') || source.includes('QueryClient'))
      .map(([file]) => file.replaceAll('\\', '/').replace(`${workspaceRoot.replaceAll('\\', '/')}/`, ''));

    expect(contractEntries.every((entry) => graph.has(entry))).toBe(true);
    expect(browserBarrels.every((barrel) => !graph.has(barrel))).toBe(true);
    expect(browserQueryDependencies).toEqual([]);
  });
});
