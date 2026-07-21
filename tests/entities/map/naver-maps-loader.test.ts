import { afterEach, describe, expect, it, vi } from 'vitest';

import * as mapEntity from '../../../src/entities/map';
import { createNaverMapsGlLoader } from '../../../src/entities/map/api/loadNaverMapsGl';

const callbackName = '__balanceKeeperNaverMapsReadyFixture';
const authFailureName = 'navermap_authFailure';

type MutableWindow = Window &
  typeof globalThis & {
    naver?: { maps?: typeof naver.maps };
    navermap_authFailure?: () => void;
    [callbackName]?: () => void;
  };

function runtimeWindow(): MutableWindow {
  return window as MutableWindow;
}

function installReadyNamespace() {
  const maps = {
    Event: {
      once: vi.fn(),
      removeListener: vi.fn(),
    },
    Map: class FixtureMap {},
    Position: { RIGHT_CENTER: 8 },
    jsContentLoaded: true,
  } as unknown as typeof naver.maps;

  runtimeWindow().naver = { maps };
  return maps;
}

function createLoader(timeoutMs = 10_000) {
  return createNaverMapsGlLoader({
    callbackName: () => callbackName,
    clearTimeout: window.clearTimeout.bind(window),
    document,
    setTimeout: window.setTimeout.bind(window),
    timeoutMs,
    window: runtimeWindow(),
  });
}

function sdkScripts() {
  return [...document.querySelectorAll<HTMLScriptElement>('script[src*="oapi.map.naver.com"]')];
}

afterEach(() => {
  vi.useRealTimers();
  for (const script of sdkScripts()) {
    script.remove();
  }
  Reflect.deleteProperty(runtimeWindow(), 'naver');
  Reflect.deleteProperty(runtimeWindow(), callbackName);
  Reflect.deleteProperty(runtimeWindow(), authFailureName);
  vi.restoreAllMocks();
});

describe('createNaverMapsGlLoader', () => {
  it('provides one loader instance through the production public entrypoint', () => {
    expect(mapEntity.getNaverMapsGlLoader).toBeTypeOf('function');
    expect(mapEntity.getNaverMapsGlLoader?.()).toBe(mapEntity.getNaverMapsGlLoader?.());
  });

  it('builds one official async GL request and shares the exact promise for concurrent callers', async () => {
    const loader = createLoader();
    const first = loader.load({ apiKeyId: 'fixture-browser-key' });
    const second = loader.load({ apiKeyId: 'fixture-browser-key' });

    expect(second).toBe(first);
    expect(sdkScripts()).toHaveLength(1);

    const script = sdkScripts()[0];
    expect(script?.async).toBe(true);
    const source = new URL(script?.src ?? '');
    expect(source.origin + source.pathname).toBe('https://oapi.map.naver.com/openapi/v3/maps.js');
    expect(source.searchParams.get('ncpKeyId')).toBe('fixture-browser-key');
    expect(source.searchParams.get('submodules')).toBe('gl');
    expect(source.searchParams.get('language')).toBe('ko');
    expect(source.searchParams.get('callback')).toBe(callbackName);

    const maps = installReadyNamespace();
    runtimeWindow()[callbackName]?.();

    await expect(first).resolves.toBe(maps);
    expect(runtimeWindow()[callbackName]).toBeUndefined();
  });

  it('reuses an already ready namespace without inserting a script', async () => {
    const maps = installReadyNamespace();
    const loader = createLoader();

    await expect(loader.load({ apiKeyId: 'fixture-browser-key' })).resolves.toBe(maps);
    expect(sdkScripts()).toHaveLength(0);
  });

  it('keeps an authentication dispatcher after SDK readiness for active map sessions', async () => {
    const priorAuthHook = vi.fn();
    runtimeWindow().navermap_authFailure = priorAuthHook;
    const loader = createLoader();
    const loading = loader.load({ apiKeyId: 'fixture-browser-key' });
    const maps = installReadyNamespace();
    runtimeWindow()[callbackName]?.();
    await expect(loading).resolves.toBe(maps);

    expect(loader.subscribeAuthenticationFailure).toBeTypeOf('function');
    const onAuthenticationFailure = vi.fn();
    const unsubscribe = loader.subscribeAuthenticationFailure(onAuthenticationFailure);

    runtimeWindow().navermap_authFailure?.();
    expect(onAuthenticationFailure).toHaveBeenCalledOnce();

    unsubscribe();
    expect(runtimeWindow().navermap_authFailure).toBe(priorAuthHook);
    runtimeWindow().navermap_authFailure?.();
    expect(onAuthenticationFailure).toHaveBeenCalledOnce();
    expect(priorAuthHook).toHaveBeenCalledTimes(2);
  });

  it('rejects a concurrent different key without exposing either value or disturbing the first load', async () => {
    const loader = createLoader();
    const first = loader.load({ apiKeyId: 'fixture-first-key' });
    const conflict = loader.load({ apiKeyId: 'fixture-second-key' });

    await expect(conflict).rejects.toMatchObject({
      code: 'CONFIG_CONFLICT',
      message: 'CONFIG_CONFLICT',
      name: 'NaverMapsLoadError',
    });
    await conflict.catch((error: unknown) => {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      expect(serialized).not.toContain('fixture-first-key');
      expect(serialized).not.toContain('fixture-second-key');
    });
    expect(sdkScripts()).toHaveLength(1);

    const maps = installReadyNamespace();
    runtimeWindow()[callbackName]?.();
    await expect(first).resolves.toBe(maps);
  });

  it('does not treat script onload as SDK readiness', async () => {
    const loader = createLoader();
    const loading = loader.load({ apiKeyId: 'fixture-browser-key' });
    let settled = false;
    void loading.finally(() => {
      settled = true;
    });

    sdkScripts()[0]?.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(settled).toBe(false);

    const maps = installReadyNamespace();
    runtimeWindow()[callbackName]?.();
    await expect(loading).resolves.toBe(maps);
  });

  it('rejects an official callback that has no valid loaded namespace', async () => {
    const loader = createLoader();
    const loading = loader.load({ apiKeyId: 'fixture-browser-key' });

    runtimeWindow()[callbackName]?.();

    await expect(loading).rejects.toMatchObject({
      code: 'NAMESPACE_MISSING',
      message: 'NAMESPACE_MISSING',
    });
    expect(sdkScripts()).toHaveLength(0);
  });

  it('rejects a loaded-looking namespace that lacks the Event lifecycle surface consumed by sessions', async () => {
    const loader = createLoader();
    const loading = loader.load({ apiKeyId: 'fixture-browser-key' });
    runtimeWindow().naver = {
      maps: {
        Map: class IncompleteFixtureMap {},
        jsContentLoaded: true,
      } as unknown as typeof naver.maps,
    };

    runtimeWindow()[callbackName]?.();

    await expect(loading).rejects.toMatchObject({ code: 'NAMESPACE_MISSING' });
  });

  it('rejects a namespace without the control position consumed by the map session', async () => {
    const loader = createLoader();
    const loading = loader.load({ apiKeyId: 'fixture-browser-key' });
    runtimeWindow().naver = {
      maps: {
        Event: { once: vi.fn(), removeListener: vi.fn() },
        Map: class IncompleteFixtureMap {},
        jsContentLoaded: true,
      } as unknown as typeof naver.maps,
    };

    runtimeWindow()[callbackName]?.();

    await expect(loading).rejects.toMatchObject({ code: 'NAMESPACE_MISSING' });
  });

  it('maps network and authentication failures to safe codes and restores the prior auth hook', async () => {
    const priorAuthHook = vi.fn();
    runtimeWindow().navermap_authFailure = priorAuthHook;
    const loader = createLoader();

    const networkLoad = loader.load({ apiKeyId: 'fixture-network-key' });
    sdkScripts()[0]?.dispatchEvent(new Event('error'));
    await expect(networkLoad).rejects.toMatchObject({ code: 'NETWORK_FAILED', message: 'NETWORK_FAILED' });
    expect(runtimeWindow().navermap_authFailure).toBe(priorAuthHook);

    const authLoad = loader.load({ apiKeyId: 'fixture-auth-key' });
    runtimeWindow().navermap_authFailure?.();
    await expect(authLoad).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      message: 'AUTHENTICATION_FAILED',
    });
    expect(priorAuthHook).toHaveBeenCalledTimes(1);
    expect(runtimeWindow().navermap_authFailure).toBe(priorAuthHook);
    expect(sdkScripts()).toHaveLength(0);
  });

  it('settles authentication failure before notifying a re-entrant prior auth hook', async () => {
    let capturedReadyCallback: () => void = () => undefined;
    const priorAuthHook = vi.fn(() => capturedReadyCallback());
    runtimeWindow().navermap_authFailure = priorAuthHook;
    const loader = createLoader();
    const loading = loader.load({ apiKeyId: 'fixture-auth-key' });
    capturedReadyCallback = runtimeWindow()[callbackName] ?? (() => undefined);
    installReadyNamespace();

    runtimeWindow().navermap_authFailure?.();

    await expect(loading).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(priorAuthHook).toHaveBeenCalledOnce();
  });

  it('preserves auth and ready globals installed by another owner during a failing load', async () => {
    const loader = createLoader();
    const loading = loader.load({ apiKeyId: 'fixture-browser-key' });
    const replacementReady = vi.fn();
    const replacementAuth = vi.fn();
    runtimeWindow()[callbackName] = replacementReady;
    runtimeWindow().navermap_authFailure = replacementAuth;

    sdkScripts()[0]?.dispatchEvent(new Event('error'));

    await expect(loading).rejects.toMatchObject({ code: 'NETWORK_FAILED' });
    expect(runtimeWindow()[callbackName]).toBe(replacementReady);
    expect(runtimeWindow().navermap_authFailure).toBe(replacementAuth);

    Reflect.deleteProperty(runtimeWindow(), callbackName);
    const retry = loader.load({ apiKeyId: 'fixture-browser-key' });
    const maps = installReadyNamespace();
    runtimeWindow()[callbackName]?.();
    await expect(retry).resolves.toBe(maps);
    expect(runtimeWindow().navermap_authFailure).toBe(replacementAuth);
  });

  it('times out at the deadline, cleans its globals, and permits a fresh retry', async () => {
    vi.useFakeTimers();
    const loader = createNaverMapsGlLoader({
      callbackName: () => callbackName,
      clearTimeout: window.clearTimeout.bind(window),
      document,
      setTimeout: window.setTimeout.bind(window),
      timeoutMs: 25,
      window: runtimeWindow(),
    });
    const first = loader.load({ apiKeyId: 'fixture-browser-key' });
    const lateCallback = runtimeWindow()[callbackName];
    const timedOut = expect(first).rejects.toMatchObject({ code: 'LOAD_TIMEOUT', message: 'LOAD_TIMEOUT' });

    await vi.advanceTimersByTimeAsync(25);
    await timedOut;
    expect(runtimeWindow()[callbackName]).toBeUndefined();
    expect(sdkScripts()).toHaveLength(0);

    const retry = loader.load({ apiKeyId: 'fixture-browser-key' });
    lateCallback?.();
    await Promise.resolve();

    const maps = installReadyNamespace();
    runtimeWindow()[callbackName]?.();
    await expect(retry).resolves.toBe(maps);
  });

  it('fails closed when its callback name already belongs to another global', async () => {
    const existingCallback = vi.fn();
    runtimeWindow()[callbackName] = existingCallback;
    const loader = createLoader();

    await expect(loader.load({ apiKeyId: 'fixture-browser-key' })).rejects.toMatchObject({
      code: 'CALLBACK_CONFLICT',
      message: 'CALLBACK_CONFLICT',
    });
    expect(runtimeWindow()[callbackName]).toBe(existingCallback);
    expect(sdkScripts()).toHaveLength(0);
  });

  it('turns a synchronous document append failure into a retryable safe network failure', async () => {
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementationOnce(() => {
      throw new Error('fixture append detail');
    });
    const loader = createLoader();

    const failed = loader.load({ apiKeyId: 'fixture-secret-key' });
    await expect(failed).rejects.toMatchObject({ code: 'NETWORK_FAILED', message: 'NETWORK_FAILED' });
    await failed.catch((error: unknown) => {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      expect(serialized).not.toContain('fixture-secret-key');
      expect(serialized).not.toContain('fixture append detail');
    });
    expect(appendSpy).toHaveBeenCalledTimes(1);

    const retry = loader.load({ apiKeyId: 'fixture-secret-key' });
    const maps = installReadyNamespace();
    runtimeWindow()[callbackName]?.();
    await expect(retry).resolves.toBe(maps);
  });
});
