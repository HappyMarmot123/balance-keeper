import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKoreaMapSession, KOREA_MAP_VIEWPORT } from '../../../src/entities/map';

type FixtureListener = Readonly<{ id: number }>;

class FixtureMap {
  static instances: FixtureMap[] = [];

  readonly autoResize = vi.fn();
  readonly destroy = vi.fn();
  readonly refresh = vi.fn();
  readonly setCenter = vi.fn();
  readonly setZoom = vi.fn();

  constructor(
    readonly container: HTMLElement,
    readonly options: naver.maps.MapOptions,
  ) {
    FixtureMap.instances.push(this);
  }
}

class FixtureResizeObserver {
  static instances: FixtureResizeObserver[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    FixtureResizeObserver.instances.push(this);
  }

  emit() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function createSdk() {
  let nextListenerId = 0;
  const listeners = new Map<number, Readonly<{ eventName: string; listener: () => void }>>();
  const once = vi.fn((_target: unknown, eventName: string, listener: () => void) => {
    if (eventName !== 'init' && eventName !== 'tilesloaded') {
      throw new Error('unexpected event');
    }
    nextListenerId += 1;
    listeners.set(nextListenerId, { eventName, listener });
    return { id: nextListenerId } as FixtureListener;
  });
  const removeListener = vi.fn((listener: FixtureListener) => {
    listeners.delete(listener.id);
  });

  const emit = (eventName: string) => {
    for (const [id, entry] of listeners) {
      if (entry.eventName !== eventName) {
        continue;
      }
      listeners.delete(id);
      entry.listener();
    }
  };

  return {
    emitInit() {
      emit('init');
    },
    emitTilesLoaded() {
      emit('tilesloaded');
    },
    maps: {
      Event: { once, removeListener },
      Map: FixtureMap,
      Position: { RIGHT_CENTER: 8 },
    } as unknown as typeof naver.maps,
    once,
    removeListener,
  };
}

function createSessionOptions(maps: typeof naver.maps, container = document.createElement('div')) {
  return {
    clearTimeout: window.clearTimeout.bind(window),
    container,
    maps,
    resizeObserver: (callback: ResizeObserverCallback) => new FixtureResizeObserver(callback),
    setTimeout: window.setTimeout.bind(window),
  };
}

afterEach(() => {
  vi.useRealTimers();
  FixtureMap.instances = [];
  FixtureResizeObserver.instances = [];
  vi.restoreAllMocks();
});

describe('createKoreaMapSession', () => {
  it('constructs one GL map with the approved Korea view and custom style', () => {
    const sdk = createSdk();
    const container = document.createElement('div');
    const session = createKoreaMapSession({
      ...createSessionOptions(sdk.maps, container),
      styleId: 'fixture-published-style',
    });

    expect(FixtureMap.instances).toHaveLength(1);
    expect(FixtureMap.instances[0]?.container).toBe(container);
    expect(FixtureMap.instances[0]?.options).toEqual({
      center: KOREA_MAP_VIEWPORT.center,
      customStyleId: 'fixture-published-style',
      gl: true,
      keyboardShortcuts: true,
      maxZoom: KOREA_MAP_VIEWPORT.maxZoom,
      minZoom: KOREA_MAP_VIEWPORT.minZoom,
      zoom: KOREA_MAP_VIEWPORT.zoom,
      zoomControl: true,
      zoomControlOptions: { position: 8 },
    });
    expect(sdk.once).toHaveBeenCalledWith(FixtureMap.instances[0], 'init', expect.any(Function));

    session.destroy();
  });

  it('omits customStyleId entirely for the explicit default-GL fallback', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));

    expect(FixtureMap.instances[0]?.options).not.toHaveProperty('customStyleId');
    session.destroy();
  });

  it('refreshes after init but becomes visibly ready only after the first tiles load', async () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const map = FixtureMap.instances[0];
    let ready = false;
    void session.ready.then(() => {
      ready = true;
    });

    session.resetView();
    expect(map?.setCenter).not.toHaveBeenCalled();
    sdk.emitInit();
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(map?.autoResize).toHaveBeenCalledOnce();
    expect(map?.refresh).toHaveBeenCalledOnce();
    expect(map?.refresh).toHaveBeenCalledWith(true);

    sdk.emitTilesLoaded();
    await session.ready;
    expect(ready).toBe(true);

    session.resetView();
    expect(map?.setCenter).toHaveBeenCalledOnce();
    expect(map?.setCenter).toHaveBeenCalledWith(KOREA_MAP_VIEWPORT.center);
    expect(map?.setZoom).toHaveBeenCalledOnce();
    expect(map?.setZoom).toHaveBeenCalledWith(KOREA_MAP_VIEWPORT.zoom);
    expect(FixtureMap.instances).toHaveLength(1);
    session.destroy();
  });

  it('keeps the init listener alive when the operating GL SDK loads tiles first', async () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const map = FixtureMap.instances[0];

    sdk.emitTilesLoaded();
    await expect(session.ready).resolves.toBeUndefined();
    expect(map?.refresh).not.toHaveBeenCalled();

    sdk.emitInit();
    expect(map?.autoResize).toHaveBeenCalledOnce();
    expect(map?.refresh).toHaveBeenCalledOnce();
    expect(map?.refresh).toHaveBeenCalledWith(true);

    session.resetView();
    expect(map?.setCenter).toHaveBeenCalledWith(KOREA_MAP_VIEWPORT.center);
    session.destroy();
  });

  it('routes observed size changes through autoResize and ignores queued callbacks after destroy', () => {
    const sdk = createSdk();
    const container = document.createElement('div');
    const session = createKoreaMapSession(createSessionOptions(sdk.maps, container));
    const map = FixtureMap.instances[0];
    const observer = FixtureResizeObserver.instances[0];

    expect(observer?.observe).toHaveBeenCalledWith(container);
    observer?.emit();
    expect(map?.autoResize).toHaveBeenCalledOnce();

    session.destroy();
    observer?.emit();
    session.destroy();
    expect(map?.autoResize).toHaveBeenCalledOnce();
    expect(observer?.disconnect).toHaveBeenCalledOnce();
    expect(map?.destroy).toHaveBeenCalledOnce();
    expect(sdk.removeListener).toHaveBeenCalledTimes(2);
  });

  it('rejects and destroys at the exact first-render deadline', async () => {
    vi.useFakeTimers();
    const sdk = createSdk();
    const session = createKoreaMapSession({
      ...createSessionOptions(sdk.maps),
      renderTimeoutMs: 25,
    });
    const failed = expect(session.ready).rejects.toMatchObject({
      code: 'RENDER_TIMEOUT',
      message: 'RENDER_TIMEOUT',
      name: 'KoreaMapSessionError',
    });

    await vi.advanceTimersByTimeAsync(25);
    await failed;
    expect(FixtureMap.instances[0]?.destroy).toHaveBeenCalledOnce();
    expect(FixtureResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce();
    expect(sdk.removeListener).toHaveBeenCalledTimes(2);

    sdk.emitInit();
    expect(FixtureMap.instances[0]?.destroy).toHaveBeenCalledOnce();
  });

  it('lets the first tiles load just before the deadline win without a later timeout side effect', async () => {
    vi.useFakeTimers();
    const sdk = createSdk();
    const session = createKoreaMapSession({
      ...createSessionOptions(sdk.maps),
      renderTimeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(24);
    sdk.emitInit();
    sdk.emitTilesLoaded();
    await expect(session.ready).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(FixtureMap.instances[0]?.destroy).not.toHaveBeenCalled();
    session.destroy();
  });

  it('owns the map synchronously so destroy during init is idempotent and late init is ignored', async () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const destroyed = expect(session.ready).rejects.toMatchObject({ code: 'SESSION_DESTROYED' });

    session.destroy();
    session.destroy();
    sdk.emitInit();

    await destroyed;
    expect(FixtureMap.instances[0]?.destroy).toHaveBeenCalledOnce();
    expect(FixtureResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce();
    expect(sdk.removeListener).toHaveBeenCalledTimes(2);
  });

  it('destroys a constructed map when listener or observer setup throws', () => {
    const listenerSdk = createSdk();
    listenerSdk.once.mockImplementationOnce(() => {
      throw new Error('listener fixture detail');
    });

    expect(() => createKoreaMapSession(createSessionOptions(listenerSdk.maps))).toThrowError(
      expect.objectContaining({ code: 'INITIALIZATION_FAILED', message: 'INITIALIZATION_FAILED' }),
    );
    expect(FixtureMap.instances[0]?.destroy).toHaveBeenCalledOnce();

    FixtureMap.instances = [];
    const observerSdk = createSdk();
    expect(() =>
      createKoreaMapSession({
        ...createSessionOptions(observerSdk.maps),
        resizeObserver: () => {
          throw new Error('observer fixture detail');
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INITIALIZATION_FAILED' }));
    expect(FixtureMap.instances[0]?.destroy).toHaveBeenCalledOnce();
    expect(observerSdk.removeListener).toHaveBeenCalledTimes(2);
  });

  it('maps constructor failure to a safe code without retaining provider detail', () => {
    const sdk = createSdk();
    sdk.maps.Map = class ThrowingMap {
      constructor() {
        throw new Error('provider constructor fixture detail');
      }
    } as unknown as typeof naver.maps.Map;

    expect(() => createKoreaMapSession(createSessionOptions(sdk.maps))).toThrowError(
      expect.objectContaining({ code: 'CONSTRUCTION_FAILED', message: 'CONSTRUCTION_FAILED' }),
    );
  });

  it('disconnects an observer whose observe call throws and releases the listener and map', () => {
    const sdk = createSdk();
    const disconnect = vi.fn();

    expect(() =>
      createKoreaMapSession({
        ...createSessionOptions(sdk.maps),
        resizeObserver: () => ({
          disconnect,
          observe: () => {
            throw new Error('observe fixture detail');
          },
        }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'INITIALIZATION_FAILED' }));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(sdk.removeListener).toHaveBeenCalledTimes(2);
    expect(FixtureMap.instances[0]?.destroy).toHaveBeenCalledOnce();
  });
});
