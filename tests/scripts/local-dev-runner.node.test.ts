// @vitest-environment node

import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as runnerModule from '../../scripts/dev.mjs';

type ProcessSpec = Readonly<{
  args: readonly string[];
  command: string;
  name: string;
}>;

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    if (this.exitCode !== null || this.signalCode !== null) {
      return false;
    }
    this.signalCode = signal;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  });

  finish(code: number) {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

const runner = runnerModule as Record<string, unknown>;

describe('local development process supervisor', () => {
  it('uses direct Node children, a separate local bundle and an API-only env file', () => {
    const createDevelopmentProcessSpecs = runner.createDevelopmentProcessSpecs as
      | ((workspaceRoot: string) => readonly ProcessSpec[])
      | undefined;

    expect(createDevelopmentProcessSpecs).toBeTypeOf('function');
    if (createDevelopmentProcessSpecs === undefined) {
      return;
    }

    const workspaceRoot = join('C:', 'workspace', 'balance-keeper');
    const specs = createDevelopmentProcessSpecs(workspaceRoot);

    expect(specs.map((spec) => spec.name)).toEqual(['api-build-once', 'api-build-watch', 'api', 'web']);
    expect(specs.every((spec) => spec.command === process.execPath)).toBe(true);
    expect(specs[0]?.args).toEqual([
      join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--config',
      'vite.local-server.config.ts',
    ]);
    expect(specs[1]?.args).toContain('--watch');
    expect(specs[2]?.args).toEqual([
      '--env-file-if-exists=.env',
      '--watch-preserve-output',
      '--watch',
      join(workspaceRoot, 'dist-server-dev', 'server.mjs'),
    ]);
    expect(specs[3]?.args).toContain('--strictPort');
    expect(specs[3]?.args.join(' ')).not.toContain('.env');
  });

  it('waits for API readiness before starting Vite and cleans peers after an unexpected exit', async () => {
    const runDevelopmentStack = runner.runDevelopmentStack as
      | ((options: {
          processSpecs: readonly ProcessSpec[];
          signalSource: EventEmitter;
          spawnProcess: (spec: ProcessSpec) => FakeChild;
          waitForBundle: () => Promise<void>;
          waitForApi: () => Promise<void>;
        }) => Promise<number>)
      | undefined;

    expect(runDevelopmentStack).toBeTypeOf('function');
    if (runDevelopmentStack === undefined) {
      return;
    }

    const specs = ['api-build-once', 'api-build-watch', 'api', 'web'].map((name) => ({
      args: [],
      command: process.execPath,
      name,
    }));
    const children = new Map<string, FakeChild>();
    let markBundleReady: () => void = () => undefined;
    const bundleReady = new Promise<void>((resolve) => {
      markBundleReady = resolve;
    });
    let markApiReady: () => void = () => undefined;
    const apiReady = new Promise<void>((resolve) => {
      markApiReady = resolve;
    });
    const spawnProcess = vi.fn((spec: ProcessSpec) => {
      const child = new FakeChild();
      children.set(spec.name, child);
      if (spec.name === 'api-build-once') {
        queueMicrotask(() => child.finish(0));
      }
      return child;
    });

    const result = runDevelopmentStack({
      processSpecs: specs,
      signalSource: new EventEmitter(),
      spawnProcess,
      waitForBundle: () => bundleReady,
      waitForApi: () => apiReady,
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    expect(children.has('api')).toBe(false);
    expect(children.has('web')).toBe(false);

    markBundleReady();
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(3));
    expect(children.has('web')).toBe(false);

    markApiReady();
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(4));
    children.get('web')?.finish(2);

    await expect(result).resolves.toBe(2);
    expect(children.get('api-build-watch')?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(children.get('api')?.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('does not start watchers when the initial local server build fails', async () => {
    const runDevelopmentStack = runner.runDevelopmentStack as
      | ((options: {
          processSpecs: readonly ProcessSpec[];
          signalSource: EventEmitter;
          spawnProcess: (spec: ProcessSpec) => FakeChild;
          waitForBundle: () => Promise<void>;
          waitForApi: () => Promise<void>;
        }) => Promise<number>)
      | undefined;

    expect(runDevelopmentStack).toBeTypeOf('function');
    if (runDevelopmentStack === undefined) {
      return;
    }

    const specs = ['api-build-once', 'api-build-watch', 'api', 'web'].map((name) => ({
      args: [],
      command: process.execPath,
      name,
    }));
    const spawnProcess = vi.fn((spec: ProcessSpec) => {
      const child = new FakeChild();
      expect(spec.name).toBe('api-build-once');
      queueMicrotask(() => child.finish(3));
      return child;
    });

    await expect(
      runDevelopmentStack({
        processSpecs: specs,
        signalSource: new EventEmitter(),
        spawnProcess,
        waitForBundle: async () => undefined,
        waitForApi: async () => undefined,
      }),
    ).resolves.toBe(3);
    expect(spawnProcess).toHaveBeenCalledOnce();
  });

  it('cleans active children when spawning a later process throws', async () => {
    const runDevelopmentStack = runner.runDevelopmentStack as
      | ((options: {
          processSpecs: readonly ProcessSpec[];
          signalSource: EventEmitter;
          spawnProcess: (spec: ProcessSpec) => FakeChild;
          waitForBundle: () => Promise<void>;
          waitForApi: () => Promise<void>;
        }) => Promise<number>)
      | undefined;

    expect(runDevelopmentStack).toBeTypeOf('function');
    if (runDevelopmentStack === undefined) {
      return;
    }

    const specs = ['api-build-once', 'api-build-watch', 'api', 'web'].map((name) => ({
      args: [],
      command: process.execPath,
      name,
    }));
    const children = new Map<string, FakeChild>();
    const spawnProcess = vi.fn((spec: ProcessSpec) => {
      if (spec.name === 'web') {
        throw new Error('spawn failed');
      }
      const child = new FakeChild();
      children.set(spec.name, child);
      if (spec.name === 'api-build-once') {
        queueMicrotask(() => child.finish(0));
      }
      return child;
    });

    await expect(
      runDevelopmentStack({
        processSpecs: specs,
        signalSource: new EventEmitter(),
        spawnProcess,
        waitForBundle: async () => undefined,
        waitForApi: async () => undefined,
      }),
    ).resolves.toBe(1);
    expect(children.get('api-build-watch')?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(children.get('api')?.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('converts a child process error event to failure and cleans its peers', async () => {
    const runDevelopmentStack = runner.runDevelopmentStack as
      | ((options: {
          processSpecs: readonly ProcessSpec[];
          signalSource: EventEmitter;
          spawnProcess: (spec: ProcessSpec) => FakeChild;
          waitForBundle: () => Promise<void>;
          waitForApi: () => Promise<void>;
        }) => Promise<number>)
      | undefined;

    expect(runDevelopmentStack).toBeTypeOf('function');
    if (runDevelopmentStack === undefined) {
      return;
    }

    const specs = ['api-build-once', 'api-build-watch', 'api', 'web'].map((name) => ({
      args: [],
      command: process.execPath,
      name,
    }));
    const children = new Map<string, FakeChild>();
    const signalSource = new EventEmitter();
    const spawnProcess = vi.fn((spec: ProcessSpec) => {
      const child = new FakeChild();
      children.set(spec.name, child);
      if (spec.name === 'api-build-once') {
        queueMicrotask(() => child.finish(0));
      }
      return child;
    });
    const result = runDevelopmentStack({
      processSpecs: specs,
      signalSource,
      spawnProcess,
      waitForBundle: () => new Promise(() => undefined),
      waitForApi: async () => undefined,
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    const apiBuild = children.get('api-build-watch');
    const hasErrorListener = (apiBuild?.listenerCount('error') ?? 0) > 0;
    let resultCode: number | undefined;
    if (hasErrorListener) {
      apiBuild?.emit('error', new Error('watch spawn failed'));
      resultCode = await result;
    } else {
      signalSource.emit('SIGTERM');
      await result;
    }

    expect(hasErrorListener).toBe(true);
    expect(resultCode).toBe(1);
    expect(apiBuild?.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('enforces the absolute readiness deadline when a health request hangs', async () => {
    const waitForLocalApi = runner.waitForLocalApi as
      | ((fetchImplementation: typeof fetch) => Promise<void>)
      | undefined;

    expect(waitForLocalApi).toBeTypeOf('function');
    if (waitForLocalApi === undefined) {
      return;
    }

    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      const fetchImplementation = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }) as typeof fetch;
      const readiness = waitForLocalApi(fetchImplementation).then(
        () => 'resolved',
        () => 'rejected',
      );

      await vi.advanceTimersByTimeAsync(30_000);
      const outcome = await Promise.race([readiness, Promise.resolve('pending')]);

      expect(outcome).toBe('rejected');
      expect(requestSignal).toBeInstanceOf(AbortSignal);
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries JSON health responses until the expected ready payload arrives', async () => {
    const waitForLocalApi = runner.waitForLocalApi as
      | ((fetchImplementation: typeof fetch) => Promise<void>)
      | undefined;

    expect(waitForLocalApi).toBeTypeOf('function');
    if (waitForLocalApi === undefined) {
      return;
    }

    vi.useFakeTimers();
    try {
      const headers = { 'content-type': 'application/json' };
      const fetchImplementation = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'starting' }), { headers, status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'ok' }), { headers, status: 200 }),
        ) as typeof fetch;
      const readiness = waitForLocalApi(fetchImplementation);

      await vi.advanceTimersByTimeAsync(100);

      await expect(readiness).resolves.toBeUndefined();
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
