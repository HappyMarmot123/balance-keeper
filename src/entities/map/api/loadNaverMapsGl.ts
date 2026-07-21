const NAVER_MAPS_SDK_URL = 'https://oapi.map.naver.com/openapi/v3/maps.js';
const AUTH_FAILURE_CALLBACK = 'navermap_authFailure';
const DEFAULT_LOAD_TIMEOUT_MS = 10_000;

let callbackSequence = 0;
let productionLoader: NaverMapsGlLoader | undefined;

export type NaverMapsNamespace = typeof naver.maps;

export type NaverMapsLoadErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'CALLBACK_CONFLICT'
  | 'CONFIG_CONFLICT'
  | 'INVALID_CONFIGURATION'
  | 'LOAD_TIMEOUT'
  | 'NAMESPACE_MISSING'
  | 'NETWORK_FAILED';

export class NaverMapsLoadError extends Error {
  override readonly name = 'NaverMapsLoadError';

  constructor(readonly code: NaverMapsLoadErrorCode) {
    super(code);
  }
}

export type NaverMapsGlLoader = Readonly<{
  load(options: Readonly<{ apiKeyId: string }>): Promise<NaverMapsNamespace>;
  subscribeAuthenticationFailure(listener: () => void): () => void;
}>;

type NaverMapsLoaderRuntime = Readonly<{
  callbackName?: () => string;
  clearTimeout: (handle: number) => void;
  document: Document;
  setTimeout: (callback: () => void, delayMs: number) => number;
  timeoutMs?: number;
  window: Window;
}>;

type ActiveLoad = Readonly<{
  apiKeyId: string;
  promise: Promise<NaverMapsNamespace>;
}>;

function defaultCallbackName(): string {
  callbackSequence += 1;
  return `__balanceKeeperNaverMapsReady${callbackSequence}`;
}

function defaultRuntime(): NaverMapsLoaderRuntime {
  return {
    clearTimeout: window.clearTimeout.bind(window),
    document,
    setTimeout: window.setTimeout.bind(window),
    window,
  };
}

function readReadyNamespace(globals: Record<string, unknown>): NaverMapsNamespace | undefined {
  const naverCandidate = globals.naver;
  if (!naverCandidate || typeof naverCandidate !== 'object') {
    return undefined;
  }

  const mapsCandidate = (naverCandidate as { maps?: unknown }).maps;
  if (!mapsCandidate || typeof mapsCandidate !== 'object') {
    return undefined;
  }

  const namespace = mapsCandidate as { Map?: unknown; jsContentLoaded?: unknown };
  const eventCandidate = (mapsCandidate as { Event?: unknown }).Event;
  const eventNamespace =
    eventCandidate && typeof eventCandidate === 'object'
      ? (eventCandidate as { once?: unknown; removeListener?: unknown })
      : undefined;
  const positionCandidate = (mapsCandidate as { Position?: unknown }).Position;
  const positions =
    positionCandidate && typeof positionCandidate === 'object'
      ? (positionCandidate as { RIGHT_CENTER?: unknown })
      : undefined;
  return namespace.jsContentLoaded === true &&
    typeof namespace.Map === 'function' &&
    typeof eventNamespace?.once === 'function' &&
    typeof eventNamespace.removeListener === 'function' &&
    typeof positions?.RIGHT_CENTER === 'number'
    ? (mapsCandidate as NaverMapsNamespace)
    : undefined;
}

function safeFailure(code: NaverMapsLoadErrorCode): Promise<never> {
  return Promise.reject(new NaverMapsLoadError(code));
}

export function createNaverMapsGlLoader(runtimeInput?: NaverMapsLoaderRuntime): NaverMapsGlLoader {
  const runtime = runtimeInput ?? defaultRuntime();
  const timeoutMs = runtime.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const createCallbackName = runtime.callbackName ?? defaultCallbackName;
  const globals = runtime.window as unknown as Record<string, unknown>;
  let activeLoad: ActiveLoad | undefined;
  let loadedNamespace: NaverMapsNamespace | undefined;
  let configuredApiKeyId: string | undefined;
  let activeAuthenticationFailure: (() => void) | undefined;
  let authDispatcherInstalled = false;
  let previousAuthDescriptor: PropertyDescriptor | undefined;
  const authenticationFailureSubscribers = new Set<() => void>();

  const authDispatcher = () => {
    const previousAuthHook = previousAuthDescriptor?.value;
    activeAuthenticationFailure?.();
    for (const listener of authenticationFailureSubscribers) {
      try {
        listener();
      } catch {
        // One consumer must not prevent other active map sessions from being notified.
      }
    }

    if (typeof previousAuthHook === 'function') {
      try {
        previousAuthHook();
      } catch {
        // Provider authentication failure is already propagated through the local channel.
      }
    }
  };

  const installAuthDispatcher = () => {
    if (authDispatcherInstalled) {
      if (globals[AUTH_FAILURE_CALLBACK] === authDispatcher) {
        return true;
      }
      authDispatcherInstalled = false;
      previousAuthDescriptor = undefined;
    }

    previousAuthDescriptor = Object.getOwnPropertyDescriptor(runtime.window, AUTH_FAILURE_CALLBACK);
    globals[AUTH_FAILURE_CALLBACK] = authDispatcher;
    authDispatcherInstalled = true;
    return globals[AUTH_FAILURE_CALLBACK] === authDispatcher;
  };

  const restoreAuthDispatcher = () => {
    if (!authDispatcherInstalled) {
      return;
    }

    if (globals[AUTH_FAILURE_CALLBACK] === authDispatcher) {
      if (previousAuthDescriptor) {
        Object.defineProperty(runtime.window, AUTH_FAILURE_CALLBACK, previousAuthDescriptor);
      } else {
        Reflect.deleteProperty(runtime.window, AUTH_FAILURE_CALLBACK);
      }
    }
    authDispatcherInstalled = false;
    previousAuthDescriptor = undefined;
  };

  function load(options: Readonly<{ apiKeyId: string }>): Promise<NaverMapsNamespace> {
    const apiKeyId = options.apiKeyId.trim();
    if (apiKeyId.length === 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return safeFailure('INVALID_CONFIGURATION');
    }

    if (configuredApiKeyId && configuredApiKeyId !== apiKeyId) {
      return safeFailure('CONFIG_CONFLICT');
    }

    if (activeLoad) {
      return activeLoad.apiKeyId === apiKeyId ? activeLoad.promise : safeFailure('CONFIG_CONFLICT');
    }

    const existingNamespace = loadedNamespace ?? readReadyNamespace(globals);
    if (existingNamespace) {
      configuredApiKeyId = apiKeyId;
      loadedNamespace = existingNamespace;
      const readyPromise = Promise.resolve(existingNamespace);
      activeLoad = { apiKeyId, promise: readyPromise };
      return readyPromise;
    }

    const callbackName = createCallbackName();
    if (!/^[$A-Z_a-z][$\w]*$/.test(callbackName) || callbackName in runtime.window) {
      return safeFailure('CALLBACK_CONFLICT');
    }

    let resolveLoad: (namespace: NaverMapsNamespace) => void = () => undefined;
    let rejectLoad: (error: NaverMapsLoadError) => void = () => undefined;
    const promise = new Promise<NaverMapsNamespace>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    activeLoad = { apiKeyId, promise };

    const script = runtime.document.createElement('script');
    let timeoutHandle: number | undefined;
    let settled = false;

    const cleanup = (failed: boolean, readyHandler: () => void) => {
      if (timeoutHandle !== undefined) {
        runtime.clearTimeout(timeoutHandle);
      }
      if (globals[callbackName] === readyHandler) {
        Reflect.deleteProperty(runtime.window, callbackName);
      }
      if (failed || authenticationFailureSubscribers.size === 0) {
        restoreAuthDispatcher();
      }
      script.onerror = null;
      script.onload = null;
      if (failed) {
        script.remove();
      }
    };

    let readyHandler = () => undefined;

    const fail = (code: NaverMapsLoadErrorCode) => {
      if (settled) {
        return;
      }
      settled = true;
      activeAuthenticationFailure = undefined;
      cleanup(true, readyHandler);
      if (activeLoad?.promise === promise) {
        activeLoad = undefined;
      }
      rejectLoad(new NaverMapsLoadError(code));
    };

    const succeed = (namespace: NaverMapsNamespace) => {
      if (settled) {
        return;
      }
      settled = true;
      activeAuthenticationFailure = undefined;
      cleanup(false, readyHandler);
      configuredApiKeyId = apiKeyId;
      loadedNamespace = namespace;
      resolveLoad(namespace);
    };

    readyHandler = () => {
      const namespace = readReadyNamespace(globals);
      if (!namespace) {
        fail('NAMESPACE_MISSING');
        return;
      }
      succeed(namespace);
    };

    try {
      globals[callbackName] = readyHandler;
      if (!installAuthDispatcher()) {
        fail('CALLBACK_CONFLICT');
        return promise;
      }
      activeAuthenticationFailure = () => fail('AUTHENTICATION_FAILED');

      const source = new URL(NAVER_MAPS_SDK_URL);
      source.searchParams.set('ncpKeyId', apiKeyId);
      source.searchParams.set('submodules', 'gl');
      source.searchParams.set('language', 'ko');
      source.searchParams.set('callback', callbackName);
      script.async = true;
      script.src = source.toString();
      script.onerror = () => fail('NETWORK_FAILED');
      timeoutHandle = runtime.setTimeout(() => fail('LOAD_TIMEOUT'), timeoutMs);
      runtime.document.head.appendChild(script);
    } catch {
      fail('NETWORK_FAILED');
    }

    return promise;
  }

  function subscribeAuthenticationFailure(listener: () => void): () => void {
    if (authenticationFailureSubscribers.size === 0) {
      try {
        if (!installAuthDispatcher()) {
          throw new NaverMapsLoadError('CALLBACK_CONFLICT');
        }
      } catch (error) {
        if (error instanceof NaverMapsLoadError) {
          throw error;
        }
        throw new NaverMapsLoadError('CALLBACK_CONFLICT');
      }
    }
    authenticationFailureSubscribers.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      authenticationFailureSubscribers.delete(listener);
      if (authenticationFailureSubscribers.size === 0) {
        restoreAuthDispatcher();
      }
    };
  }

  return { load, subscribeAuthenticationFailure };
}

export function getNaverMapsGlLoader(): NaverMapsGlLoader {
  productionLoader ??= createNaverMapsGlLoader();
  return productionLoader;
}
