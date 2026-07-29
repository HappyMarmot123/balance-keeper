import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_API_HEALTH_URL = 'http://127.0.0.1:8787/healthz';
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const freezeSpec = (name, command, args) =>
  Object.freeze({
    args: Object.freeze(args),
    command,
    name,
  });

export function createDevelopmentProcessSpecs(root = workspaceRoot) {
  const viteEntry = resolve(root, 'node_modules/vite/bin/vite.js');

  return Object.freeze([
    freezeSpec('api-build-once', process.execPath, [viteEntry, 'build', '--config', 'vite.local-server.config.ts']),
    freezeSpec('api-build-watch', process.execPath, [
      viteEntry,
      'build',
      '--config',
      'vite.local-server.config.ts',
      '--watch',
    ]),
    freezeSpec('api', process.execPath, [
      '--env-file-if-exists=.env',
      '--watch-preserve-output',
      '--watch',
      resolve(root, 'dist-server-dev/server.mjs'),
    ]),
    freezeSpec('web', process.execPath, [viteEntry, '--strictPort']),
  ]);
}

const waitForChildExit = (child) =>
  new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
      return;
    }

    const onError = (error) => {
      child.off('exit', onExit);
      resolveExit({ code: null, error, signal: null });
    };
    const onExit = (code, signal) => {
      child.off('error', onError);
      resolveExit({ code, signal });
    };
    child.once('error', onError);
    child.once('exit', onExit);
  });

const delay = (durationMs) =>
  new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, durationMs);
    timer.unref?.();
  });

const isActive = (child) => child.exitCode === null && child.signalCode === null;

const terminateChildren = async (children, signal = 'SIGTERM') => {
  const activeChildren = children.filter(isActive);
  for (const child of activeChildren) {
    child.kill(signal);
  }

  await Promise.race([Promise.all(activeChildren.map(waitForChildExit)), delay(SHUTDOWN_TIMEOUT_MS)]);

  const remainingChildren = activeChildren.filter(isActive);
  for (const child of remainingChildren) {
    child.kill('SIGKILL');
  }
  if (remainingChildren.length > 0) {
    await Promise.race([Promise.all(remainingChildren.map(waitForChildExit)), delay(1_000)]);
  }
};

const normalizeUnexpectedExitCode = ({ code }) => (typeof code === 'number' && code !== 0 ? code : 1);

const createSignalWaiter = (signalSource) => {
  let resolveSignal;
  const promise = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const onSigint = () => resolveSignal('SIGINT');
  const onSigterm = () => resolveSignal('SIGTERM');
  signalSource.on('SIGINT', onSigint);
  signalSource.on('SIGTERM', onSigterm);

  return {
    dispose() {
      signalSource.off('SIGINT', onSigint);
      signalSource.off('SIGTERM', onSigterm);
    },
    promise,
  };
};

export async function waitForLocalApi(fetchImplementation = globalThis.fetch) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const abortController = new AbortController();
    const remainingMs = deadline - Date.now();
    let timeout;
    try {
      const timedOut = new Promise((_, rejectTimeout) => {
        timeout = setTimeout(() => {
          abortController.abort();
          rejectTimeout(new Error('Local API readiness request deadline exceeded'));
        }, remainingMs);
        timeout.unref?.();
      });
      const ready = await Promise.race([
        Promise.resolve().then(async () => {
          const response = await fetchImplementation(LOCAL_API_HEALTH_URL, {
            cache: 'no-store',
            redirect: 'error',
            signal: abortController.signal,
          });
          if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('application/json')) {
            return false;
          }
          const payload = await response.json();
          return typeof payload === 'object' && payload !== null && 'status' in payload && payload.status === 'ok';
        }),
        timedOut,
      ]);
      if (ready) {
        return;
      }
    } catch {
      // The API process is still starting or the absolute readiness deadline was reached.
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }

    const remainingDelayMs = deadline - Date.now();
    if (remainingDelayMs > 0) {
      await delay(Math.min(100, remainingDelayMs));
    }
  }

  throw new Error('Local API readiness deadline exceeded');
}

const readBundleState = async (bundlePath) => {
  try {
    const metadata = await stat(bundlePath);
    return `${metadata.mtimeMs}:${metadata.size}`;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

export async function createLocalBundleWaiter(bundlePath = resolve(workspaceRoot, 'dist-server-dev/server.mjs')) {
  const initialState = await readBundleState(bundlePath);

  return async () => {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const currentState = await readBundleState(bundlePath);
      if (currentState !== undefined && currentState !== initialState) {
        return;
      }
      await delay(50);
    }
    throw new Error('Local API bundle watch deadline exceeded');
  };
}

export async function runDevelopmentStack(options = {}) {
  const processSpecs = options.processSpecs ?? createDevelopmentProcessSpecs();
  const signalSource = options.signalSource ?? process;
  const spawnProcess =
    options.spawnProcess ??
    ((spec) =>
      spawn(spec.command, [...spec.args], {
        cwd: workspaceRoot,
        env: process.env,
        shell: false,
        stdio: 'inherit',
      }));
  const waitForApi = options.waitForApi ?? waitForLocalApi;
  const [buildSpec, apiBuildSpec, apiSpec, webSpec] = processSpecs;
  if (
    buildSpec === undefined ||
    apiBuildSpec === undefined ||
    apiSpec === undefined ||
    webSpec === undefined ||
    processSpecs.length !== 4
  ) {
    throw new TypeError('Local development process specification is invalid');
  }

  const children = [];
  const signalWaiter = createSignalWaiter(signalSource);

  try {
    const build = spawnProcess(buildSpec);
    children.push(build);
    const buildOutcome = await Promise.race([
      waitForChildExit(build).then((outcome) => ({ kind: 'exit', outcome })),
      signalWaiter.promise.then((signal) => ({ kind: 'signal', signal })),
    ]);
    if (buildOutcome.kind === 'signal') {
      await terminateChildren(children, buildOutcome.signal);
      return 0;
    }
    if (buildOutcome.outcome.code !== 0) {
      return normalizeUnexpectedExitCode(buildOutcome.outcome);
    }

    const waitForBundle = options.waitForBundle ?? (await createLocalBundleWaiter());
    const apiBuild = spawnProcess(apiBuildSpec);
    children.push(apiBuild);

    const bundleOutcome = await Promise.race([
      waitForBundle().then(
        () => ({ kind: 'ready' }),
        () => ({ kind: 'readiness-failure' }),
      ),
      waitForChildExit(apiBuild).then((outcome) => ({ kind: 'exit', outcome })),
      signalWaiter.promise.then((signal) => ({ kind: 'signal', signal })),
    ]);
    if (bundleOutcome.kind !== 'ready') {
      await terminateChildren(children, bundleOutcome.kind === 'signal' ? bundleOutcome.signal : 'SIGTERM');
      return bundleOutcome.kind === 'exit'
        ? normalizeUnexpectedExitCode(bundleOutcome.outcome)
        : bundleOutcome.kind === 'signal'
          ? 0
          : 1;
    }

    const api = spawnProcess(apiSpec);
    children.push(api);

    const startupOutcome = await Promise.race([
      waitForApi().then(
        () => ({ kind: 'ready' }),
        () => ({ kind: 'readiness-failure' }),
      ),
      waitForChildExit(apiBuild).then((outcome) => ({ kind: 'exit', outcome })),
      waitForChildExit(api).then((outcome) => ({ kind: 'exit', outcome })),
      signalWaiter.promise.then((signal) => ({ kind: 'signal', signal })),
    ]);
    if (startupOutcome.kind !== 'ready') {
      await terminateChildren(children, startupOutcome.kind === 'signal' ? startupOutcome.signal : 'SIGTERM');
      return startupOutcome.kind === 'exit'
        ? normalizeUnexpectedExitCode(startupOutcome.outcome)
        : startupOutcome.kind === 'signal'
          ? 0
          : 1;
    }

    const web = spawnProcess(webSpec);
    children.push(web);
    const runningOutcome = await Promise.race([
      ...children.slice(1).map((child) => waitForChildExit(child).then((outcome) => ({ kind: 'exit', outcome }))),
      signalWaiter.promise.then((signal) => ({ kind: 'signal', signal })),
    ]);
    await terminateChildren(children, runningOutcome.kind === 'signal' ? runningOutcome.signal : 'SIGTERM');
    return runningOutcome.kind === 'signal' ? 0 : normalizeUnexpectedExitCode(runningOutcome.outcome);
  } catch {
    return 1;
  } finally {
    await terminateChildren(children);
    signalWaiter.dispose();
  }
}

const executedUrl = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (executedUrl === import.meta.url) {
  process.exitCode = await runDevelopmentStack();
}
