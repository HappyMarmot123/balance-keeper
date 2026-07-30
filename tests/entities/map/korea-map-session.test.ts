import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKoreaMapSession, KOREA_MAP_VIEWPORT } from '../../../src/entities/map';

type FixtureListener = Readonly<{ id: number }>;

class FixtureMap {
  static instances: FixtureMap[] = [];

  readonly autoResize = vi.fn();
  readonly destroy = vi.fn();
  readonly getBounds = vi.fn(() => this.bounds);
  readonly getZoom = vi.fn(() => this.zoom);
  readonly refresh = vi.fn();
  readonly setCenter = vi.fn();
  readonly setZoom = vi.fn();
  bounds = {
    maxX: () => 127.5,
    maxY: () => 38,
    minX: () => 126.5,
    minY: () => 37,
  } as naver.maps.Bounds;
  zoom = 11;

  constructor(
    readonly container: HTMLElement,
    readonly options: naver.maps.MapOptions,
  ) {
    FixtureMap.instances.push(this);
  }
}

class FixtureMarker {
  static instances: FixtureMarker[] = [];
  static throwAtConstruction: number | undefined;

  readonly element = document.createElement('div');
  readonly setMap = vi.fn();

  constructor(readonly options: naver.maps.MarkerOptions) {
    if (FixtureMarker.instances.length + 1 === FixtureMarker.throwAtConstruction) {
      throw new Error('fixture marker construction failure');
    }
    FixtureMarker.instances.push(this);
  }

  getElement() {
    return this.element;
  }
}

class FixtureLatLng {
  constructor(
    readonly latitude: number,
    readonly longitude: number,
  ) {}
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
  const listeners = new Map<
    number,
    Readonly<{ eventName: string; listener: () => void; once: boolean; target: unknown }>
  >();
  const once = vi.fn((_target: unknown, eventName: string, listener: () => void) => {
    if (eventName !== 'init' && eventName !== 'tilesloaded') {
      throw new Error('unexpected event');
    }
    nextListenerId += 1;
    listeners.set(nextListenerId, { eventName, listener, once: true, target: _target });
    return { id: nextListenerId } as FixtureListener;
  });
  const addListener = vi.fn((target: unknown, eventName: string, listener: () => void) => {
    nextListenerId += 1;
    listeners.set(nextListenerId, { eventName, listener, once: false, target });
    return { id: nextListenerId } as FixtureListener;
  });
  const removeListener = vi.fn((listener: FixtureListener) => {
    listeners.delete(listener.id);
  });

  const emit = (eventName: string, target?: unknown) => {
    for (const [id, entry] of listeners) {
      if (entry.eventName !== eventName || (target !== undefined && entry.target !== target)) {
        continue;
      }
      if (entry.once) {
        listeners.delete(id);
      }
      entry.listener();
    }
  };

  return {
    addListener,
    emitInit() {
      emit('init');
    },
    emitIdle() {
      emit('idle', FixtureMap.instances[0]);
    },
    emitMarkerClick(marker: FixtureMarker) {
      emit('click', marker);
    },
    emitTilesLoaded() {
      emit('tilesloaded');
    },
    maps: {
      Event: { addListener, once, removeListener },
      LatLng: FixtureLatLng,
      Map: FixtureMap,
      Marker: FixtureMarker,
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
  FixtureMarker.instances = [];
  FixtureMarker.throwAtConstruction = undefined;
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

  it('publishes the current viewport after init and releases the idle listener', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const viewportSession = session as typeof session & {
      subscribeViewport?: (
        listener: (viewport: {
          maximumLatitude: number;
          maximumLongitude: number;
          minimumLatitude: number;
          minimumLongitude: number;
          zoom: number;
        }) => void,
      ) => () => void;
    };
    const listener = vi.fn();

    expect(viewportSession.subscribeViewport).toBeTypeOf('function');
    if (viewportSession.subscribeViewport === undefined) {
      return;
    }

    const unsubscribe = viewportSession.subscribeViewport(listener);
    expect(listener).not.toHaveBeenCalled();

    sdk.emitInit();
    expect(listener).toHaveBeenLastCalledWith({
      maximumLatitude: 38,
      maximumLongitude: 127.5,
      minimumLatitude: 37,
      minimumLongitude: 126.5,
      zoom: 11,
    });

    const map = FixtureMap.instances[0];
    if (map === undefined) {
      throw new TypeError('Expected a fixture map');
    }
    map.bounds = {
      maxX: () => 127.4,
      maxY: () => 37.9,
      minX: () => 126.7,
      minY: () => 37.2,
    } as naver.maps.Bounds;
    map.zoom = 12;
    sdk.emitIdle();
    expect(listener).toHaveBeenLastCalledWith({
      maximumLatitude: 37.9,
      maximumLongitude: 127.4,
      minimumLatitude: 37.2,
      minimumLongitude: 126.7,
      zoom: 12,
    });

    unsubscribe();
    sdk.emitIdle();
    expect(listener).toHaveBeenCalledTimes(2);
    session.destroy();
  });

  it('publishes changed bounds after the observed map container resizes without waiting for idle', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const listener = vi.fn();
    session.subscribeViewport(listener);
    sdk.emitInit();
    expect(listener).toHaveBeenCalledOnce();

    const map = FixtureMap.instances[0];
    if (map === undefined) {
      throw new TypeError('Expected a fixture map');
    }
    map.bounds = {
      maxX: () => 127.2,
      maxY: () => 37.8,
      minX: () => 126.8,
      minY: () => 37.4,
    } as naver.maps.Bounds;
    FixtureResizeObserver.instances[0]?.emit();

    expect(map.autoResize).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      maximumLatitude: 37.8,
      maximumLongitude: 127.2,
      minimumLatitude: 37.4,
      minimumLongitude: 126.8,
      zoom: 11,
    });
    expect(listener).toHaveBeenCalledTimes(2);
    session.destroy();
  });

  it('owns accessible point-marker replacement and listener cleanup inside one layer', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const pointSession = session as typeof session & {
      createPointLayer?: (options: Readonly<{ onSelect: (id: string) => void }>) => {
        destroy(): void;
        replace(
          points: readonly Readonly<{
            accessibleName: string;
            id: string;
            latitude: number;
            longitude: number;
          }>[],
        ): void;
        select(id: string | undefined): void;
      };
    };
    const onSelect = vi.fn();

    expect(pointSession.createPointLayer).toBeTypeOf('function');
    if (pointSession.createPointLayer === undefined) {
      return;
    }

    const layer = pointSession.createPointLayer({ onSelect });
    layer.replace([
      {
        accessibleName: '서울 첫 번째 CCTV',
        id: 'camera-a',
        latitude: 37.5,
        longitude: 127,
      },
      {
        accessibleName: '서울 두 번째 CCTV',
        id: 'camera-b',
        latitude: 37.6,
        longitude: 127.1,
      },
    ]);

    expect(FixtureMarker.instances).toHaveLength(2);
    const firstMarker = FixtureMarker.instances[0];
    expect(firstMarker?.options).toMatchObject({
      clickable: true,
      map: FixtureMap.instances[0],
      position: expect.objectContaining({ latitude: 37.5, longitude: 127 }),
      title: '서울 첫 번째 CCTV',
    });
    expect(firstMarker?.element.getAttribute('role')).toBe('button');
    expect(firstMarker?.element.getAttribute('aria-label')).toBe('서울 첫 번째 CCTV');
    expect(firstMarker?.element.getAttribute('aria-pressed')).toBe('false');
    expect(firstMarker?.element.dataset.selected).toBe('false');
    expect(firstMarker?.element.tabIndex).toBe(0);

    layer.select('camera-b');
    expect(firstMarker?.element.getAttribute('aria-pressed')).toBe('false');
    expect(firstMarker?.element.dataset.selected).toBe('false');
    expect(FixtureMarker.instances[1]?.element.getAttribute('aria-pressed')).toBe('true');
    expect(FixtureMarker.instances[1]?.element.dataset.selected).toBe('true');

    if (firstMarker === undefined) {
      throw new TypeError('Expected a fixture marker');
    }
    sdk.emitMarkerClick(firstMarker);
    firstMarker.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(onSelect).toHaveBeenNthCalledWith(1, 'camera-a');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'camera-a');

    layer.replace([
      {
        accessibleName: '교체된 CCTV',
        id: 'camera-c',
        latitude: 37.7,
        longitude: 127.2,
      },
    ]);
    expect(firstMarker.setMap).toHaveBeenCalledOnce();
    expect(firstMarker.setMap).toHaveBeenCalledWith(null);
    firstMarker.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(onSelect).toHaveBeenCalledTimes(2);

    const replacement = FixtureMarker.instances[2];
    layer.destroy();
    layer.destroy();
    expect(replacement?.setMap).toHaveBeenCalledOnce();
    expect(replacement?.setMap).toHaveBeenCalledWith(null);
    session.destroy();
  });

  it('cleans a partially constructed point layer when the provider rejects a later marker', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = session.createPointLayer({ onSelect: vi.fn() });
    FixtureMarker.throwAtConstruction = 2;

    expect(() =>
      layer.replace([
        {
          accessibleName: '첫 번째 CCTV',
          id: 'camera-a',
          latitude: 37.5,
          longitude: 127,
        },
        {
          accessibleName: '두 번째 CCTV',
          id: 'camera-b',
          latitude: 37.6,
          longitude: 127.1,
        },
      ]),
    ).not.toThrow();

    expect(FixtureMarker.instances).toHaveLength(1);
    expect(FixtureMarker.instances[0]?.setMap).toHaveBeenCalledOnce();
    expect(FixtureMarker.instances[0]?.setMap).toHaveBeenCalledWith(null);
    session.destroy();
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
