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

class FixturePolyline {
  static instances: FixturePolyline[] = [];

  readonly setMap = vi.fn();

  constructor(readonly options: naver.maps.PolylineOptions) {
    FixturePolyline.instances.push(this);
  }
}

class FixturePolygon {
  static instances: FixturePolygon[] = [];

  readonly setMap = vi.fn();

  constructor(readonly options: naver.maps.PolygonOptions) {
    FixturePolygon.instances.push(this);
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
    emitOverlayClick(overlay: FixtureMarker | FixturePolygon | FixturePolyline) {
      emit('click', overlay);
    },
    emitTilesLoaded() {
      emit('tilesloaded');
    },
    maps: {
      Event: { addListener, once, removeListener },
      LatLng: FixtureLatLng,
      Map: FixtureMap,
      Marker: FixtureMarker,
      Polygon: FixturePolygon,
      Position: { RIGHT_CENTER: 8 },
      Polyline: FixturePolyline,
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

type FixtureGeometry =
  | Readonly<{ kind: 'area'; ring: readonly (readonly [number, number])[] }>
  | Readonly<{ kind: 'line'; path: readonly (readonly [number, number])[] }>
  | Readonly<{ kind: 'point'; position: readonly [number, number] }>;

type FixtureGeometryFeature = Readonly<{
  accessibleName: string;
  geometry: FixtureGeometry;
  id: string;
}>;

type FixtureReplaceResult = Readonly<{
  reason?: string;
  status: string;
}>;

type FixtureGeometryLayer = Readonly<{
  destroy(): void;
  replace(features: readonly FixtureGeometryFeature[]): FixtureReplaceResult;
}>;

function readGeometryLayer(
  session: ReturnType<typeof createKoreaMapSession>,
  onSelect: (id: string) => void,
): FixtureGeometryLayer | undefined {
  const geometrySession = session as typeof session & {
    createGeometryLayer?: (options: Readonly<{ onSelect: (id: string) => void }>) => FixtureGeometryLayer;
  };

  expect(geometrySession.createGeometryLayer).toBeTypeOf('function');
  return geometrySession.createGeometryLayer?.({ onSelect });
}

function createPointFixtures(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    accessibleName: `관측 지점 ${index + 1}`,
    id: `point-${index + 1}`,
    latitude: 33 + (index % 100) * 0.001,
    longitude: 124 + Math.floor(index / 100) * 0.001,
  }));
}

function createGeometryPath(count: number, latitudeOffset = 0): readonly (readonly [number, number])[] {
  return Array.from(
    { length: count },
    (_, index) => [124 + (index % 1_000) * 0.001, 33 + latitudeOffset + Math.floor(index / 1_000) * 0.001] as const,
  );
}

afterEach(() => {
  vi.useRealTimers();
  FixtureMap.instances = [];
  FixtureMarker.instances = [];
  FixtureMarker.throwAtConstruction = undefined;
  FixturePolygon.instances = [];
  FixturePolyline.instances = [];
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
    firstMarker.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    expect(onSelect).toHaveBeenNthCalledWith(1, 'camera-a');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'camera-a');
    expect(onSelect).toHaveBeenNthCalledWith(3, 'camera-a');

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
    expect(onSelect).toHaveBeenCalledTimes(3);

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

  it('cleans the current point marker when provider click-listener registration fails', () => {
    const sdk = createSdk();
    const onSelect = vi.fn();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = session.createPointLayer({ onSelect });
    sdk.addListener.mockImplementationOnce(() => {
      throw new Error('fixture point listener failure');
    });

    const result = layer.replace(createPointFixtures(1));

    expect.soft(result).toMatchObject({ reason: 'RENDER_FAILED', status: 'rejected' });
    const marker = FixtureMarker.instances[0];
    expect.soft(marker?.setMap).toHaveBeenCalledOnce();
    expect.soft(marker?.setMap).toHaveBeenCalledWith(null);
    marker?.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect.soft(onSelect).not.toHaveBeenCalled();
    session.destroy();
  });

  it('cleans the current point marker when its accessible element cannot be read', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = session.createPointLayer({ onSelect: vi.fn() });
    vi.spyOn(FixtureMarker.prototype, 'getElement').mockImplementationOnce(() => {
      throw new Error('fixture marker element failure');
    });

    const result = layer.replace(createPointFixtures(1));

    expect.soft(result).toMatchObject({ reason: 'RENDER_FAILED', status: 'rejected' });
    expect.soft(FixtureMarker.instances[0]?.setMap).toHaveBeenCalledOnce();
    expect.soft(FixtureMarker.instances[0]?.setMap).toHaveBeenCalledWith(null);
    session.destroy();
  });

  it('accepts exactly 240 point markers in one bounded session layer', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = session.createPointLayer({ onSelect: vi.fn() });

    const result = layer.replace(createPointFixtures(240));

    expect.soft(result).toMatchObject({ status: 'replaced' });
    expect(FixtureMarker.instances).toHaveLength(240);
    session.destroy();
  });

  it('rejects 241 point markers before constructing any provider overlay', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = session.createPointLayer({ onSelect: vi.fn() });

    const result = layer.replace(createPointFixtures(241));

    expect.soft(result).toMatchObject({
      reason: 'POINT_BUDGET_EXCEEDED',
      status: 'rejected',
    });
    expect(FixtureMarker.instances).toHaveLength(0);
    session.destroy();
  });

  it('treats an identical point signature as a no-op without rebuilding markers', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = session.createPointLayer({ onSelect: vi.fn() });
    const points = createPointFixtures(1);

    layer.replace(points);
    const original = FixtureMarker.instances[0];
    const result = layer.replace(points.map((point) => ({ ...point })));

    expect.soft(result).toMatchObject({ status: 'unchanged' });
    expect.soft(FixtureMarker.instances).toHaveLength(1);
    expect(original?.setMap).not.toHaveBeenCalled();
    session.destroy();
  });

  it('keeps prior point markers and listeners when a replacement transaction fails', () => {
    const sdk = createSdk();
    const onSelect = vi.fn();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = session.createPointLayer({ onSelect });
    layer.replace(createPointFixtures(1));
    const original = FixtureMarker.instances[0];
    if (original === undefined) {
      throw new TypeError('Expected an original fixture marker');
    }
    FixtureMarker.throwAtConstruction = 3;

    const result = layer.replace(createPointFixtures(2));

    expect.soft(result).toMatchObject({ reason: 'RENDER_FAILED', status: 'rejected' });
    expect.soft(original.setMap).not.toHaveBeenCalled();
    expect.soft(FixtureMarker.instances).toHaveLength(2);
    expect.soft(FixtureMarker.instances[1]?.setMap).toHaveBeenCalledOnce();
    expect.soft(FixtureMarker.instances[1]?.setMap).toHaveBeenCalledWith(null);
    sdk.emitMarkerClick(original);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('point-1');
    session.destroy();
  });

  it('renders point, line and area geometries with their real paths and click selection', () => {
    const sdk = createSdk();
    const onSelect = vi.fn();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = readGeometryLayer(session, onSelect);
    if (layer === undefined) {
      session.destroy();
      return;
    }

    const pointPosition = [127, 37.5] as const;
    const linePath = [
      [127.01, 37.51],
      [127.02, 37.52],
    ] as const;
    const areaRing = [
      [127.03, 37.53],
      [127.04, 37.53],
      [127.04, 37.54],
    ] as const;
    const result = layer.replace([
      {
        accessibleName: '지점형 도로재난',
        geometry: { kind: 'point', position: pointPosition },
        id: 'geometry-point',
      },
      {
        accessibleName: '선형 도로재난',
        geometry: { kind: 'line', path: linePath },
        id: 'geometry-line',
      },
      {
        accessibleName: '영역형 도로재난',
        geometry: { kind: 'area', ring: areaRing },
        id: 'geometry-area',
      },
    ]);

    expect.soft(result).toMatchObject({ status: 'replaced' });
    expect(FixtureMarker.instances).toHaveLength(1);
    expect(FixturePolyline.instances).toHaveLength(1);
    expect(FixturePolygon.instances).toHaveLength(1);
    expect(FixtureMarker.instances[0]?.options).toMatchObject({
      clickable: true,
      map: FixtureMap.instances[0],
      position: expect.objectContaining({ latitude: 37.5, longitude: 127 }),
      title: '지점형 도로재난',
    });
    expect(FixturePolyline.instances[0]?.options).toMatchObject({
      clickable: true,
      map: FixtureMap.instances[0],
      path: linePath.map(([longitude, latitude]) => expect.objectContaining({ latitude, longitude })),
    });

    const polygonPaths = FixturePolygon.instances[0]?.options.paths as
      | readonly (readonly FixtureLatLng[])[]
      | undefined;
    const renderedRing = polygonPaths?.[0];
    expect(FixturePolygon.instances[0]?.options).toMatchObject({
      clickable: true,
      map: FixtureMap.instances[0],
    });
    expect(renderedRing?.slice(0, areaRing.length)).toEqual(
      areaRing.map(([longitude, latitude]) => expect.objectContaining({ latitude, longitude })),
    );
    expect([areaRing.length, areaRing.length + 1]).toContain(renderedRing?.length);
    if (renderedRing?.length === areaRing.length + 1) {
      expect(renderedRing.at(-1)).toEqual(renderedRing[0]);
    }

    const point = FixtureMarker.instances[0];
    const line = FixturePolyline.instances[0];
    const area = FixturePolygon.instances[0];
    if (point === undefined || line === undefined || area === undefined) {
      throw new TypeError('Expected all geometry overlays');
    }
    sdk.emitOverlayClick(point);
    sdk.emitOverlayClick(line);
    sdk.emitOverlayClick(area);
    expect(onSelect).toHaveBeenNthCalledWith(1, 'geometry-point');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'geometry-line');
    expect(onSelect).toHaveBeenNthCalledWith(3, 'geometry-area');

    layer.destroy();
    layer.destroy();
    expect(point.setMap).toHaveBeenCalledOnce();
    expect(line.setMap).toHaveBeenCalledOnce();
    expect(area.setMap).toHaveBeenCalledOnce();
    expect(point.setMap).toHaveBeenCalledWith(null);
    expect(line.setMap).toHaveBeenCalledWith(null);
    expect(area.setMap).toHaveBeenCalledWith(null);
    session.destroy();
  });

  it('cleans the current geometry overlay when provider click-listener registration fails', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = readGeometryLayer(session, vi.fn());
    if (layer === undefined) {
      session.destroy();
      return;
    }
    sdk.addListener.mockImplementationOnce(() => {
      throw new Error('fixture geometry listener failure');
    });

    const result = layer.replace([
      {
        accessibleName: '리스너 실패 선형 도로재난',
        geometry: { kind: 'line', path: createGeometryPath(2) },
        id: 'listener-failure-line',
      },
    ]);

    expect.soft(result).toMatchObject({ reason: 'RENDER_FAILED', status: 'rejected' });
    const line = FixturePolyline.instances[0];
    expect.soft(line?.setMap).toHaveBeenCalledOnce();
    expect.soft(line?.setMap).toHaveBeenCalledWith(null);
    session.destroy();
  });

  it('accepts exactly 4,000 geometry vertices and rejects 4,001 transactionally', () => {
    const sdk = createSdk();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const layer = readGeometryLayer(session, vi.fn());
    if (layer === undefined) {
      session.destroy();
      return;
    }
    const exactBudget: readonly FixtureGeometryFeature[] = [
      {
        accessibleName: '첫 번째 2,000개 정점 선',
        geometry: { kind: 'line', path: createGeometryPath(2_000) },
        id: 'line-a',
      },
      {
        accessibleName: '두 번째 2,000개 정점 선',
        geometry: { kind: 'line', path: createGeometryPath(2_000, 0.01) },
        id: 'line-b',
      },
    ];

    const accepted = layer.replace(exactBudget);

    expect.soft(accepted).toMatchObject({ status: 'replaced' });
    expect(FixturePolyline.instances).toHaveLength(2);
    const priorLines = [...FixturePolyline.instances];

    const rejected = layer.replace([
      ...exactBudget,
      {
        accessibleName: '4,001번째 정점',
        geometry: { kind: 'point', position: [127, 37] },
        id: 'point-over-budget',
      },
    ]);

    expect.soft(rejected).toMatchObject({
      reason: 'GEOMETRY_VERTEX_BUDGET_EXCEEDED',
      status: 'rejected',
    });
    expect.soft(FixturePolyline.instances).toHaveLength(2);
    expect.soft(FixtureMarker.instances).toHaveLength(0);
    for (const line of priorLines) {
      expect.soft(line.setMap).not.toHaveBeenCalled();
    }
    session.destroy();
  });

  it('cleans multiple point and geometry layers independently', () => {
    const sdk = createSdk();
    const pointSelect = vi.fn();
    const lineSelect = vi.fn();
    const areaSelect = vi.fn();
    const session = createKoreaMapSession(createSessionOptions(sdk.maps));
    const pointLayer = session.createPointLayer({ onSelect: pointSelect });
    const lineLayer = readGeometryLayer(session, lineSelect);
    const areaLayer = readGeometryLayer(session, areaSelect);
    if (lineLayer === undefined || areaLayer === undefined) {
      session.destroy();
      return;
    }

    pointLayer.replace(createPointFixtures(1));
    lineLayer.replace([
      {
        accessibleName: '독립 선 레이어',
        geometry: { kind: 'line', path: createGeometryPath(2) },
        id: 'line-independent',
      },
    ]);
    areaLayer.replace([
      {
        accessibleName: '독립 영역 레이어',
        geometry: {
          kind: 'area',
          ring: [
            [127, 37],
            [127.1, 37],
            [127.1, 37.1],
          ],
        },
        id: 'area-independent',
      },
    ]);
    const point = FixtureMarker.instances[0];
    const line = FixturePolyline.instances[0];
    const area = FixturePolygon.instances[0];
    if (point === undefined || line === undefined || area === undefined) {
      throw new TypeError('Expected independently owned fixture overlays');
    }

    lineLayer.destroy();
    expect.soft(line.setMap).toHaveBeenCalledOnce();
    expect.soft(point.setMap).not.toHaveBeenCalled();
    expect.soft(area.setMap).not.toHaveBeenCalled();
    sdk.emitOverlayClick(area);
    expect(areaSelect).toHaveBeenCalledWith('area-independent');
    expect(pointSelect).not.toHaveBeenCalled();
    expect(lineSelect).not.toHaveBeenCalled();

    session.destroy();
    expect(point.setMap).toHaveBeenCalledOnce();
    expect(area.setMap).toHaveBeenCalledOnce();
    expect(line.setMap).toHaveBeenCalledOnce();
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
