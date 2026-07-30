import type { NaverMapsNamespace } from '../api/loadNaverMapsGl';
import { KOREA_MAP_VIEWPORT } from '../model/map';

const DEFAULT_RENDER_TIMEOUT_MS = 10_000;

export type KoreaMapSessionErrorCode =
  | 'CONSTRUCTION_FAILED'
  | 'INITIALIZATION_FAILED'
  | 'RENDER_TIMEOUT'
  | 'SESSION_DESTROYED';

export class KoreaMapSessionError extends Error {
  override readonly name = 'KoreaMapSessionError';

  constructor(readonly code: KoreaMapSessionErrorCode) {
    super(code);
  }
}

export type KoreaMapViewport = Readonly<{
  maximumLatitude: number;
  maximumLongitude: number;
  minimumLatitude: number;
  minimumLongitude: number;
  zoom: number;
}>;

export type KoreaMapPoint = Readonly<{
  accessibleName: string;
  id: string;
  latitude: number;
  longitude: number;
}>;

export type KoreaMapPointLayer = Readonly<{
  destroy(): void;
  replace(points: readonly KoreaMapPoint[]): void;
  select(id: string | undefined): void;
}>;

export type KoreaMapSession = Readonly<{
  createPointLayer(options: Readonly<{ onSelect: (id: string) => void }>): KoreaMapPointLayer;
  destroy(): void;
  ready: Promise<void>;
  resetView(): void;
  subscribeViewport(listener: (viewport: KoreaMapViewport) => void): () => void;
}>;

type ResizeObserverPort = Readonly<{
  disconnect(): void;
  observe(target: Element): void;
}>;

type CreateKoreaMapSessionOptions = Readonly<{
  clearTimeout?: (handle: number) => void;
  container: HTMLElement;
  renderTimeoutMs?: number;
  maps: NaverMapsNamespace;
  resizeObserver?: (callback: ResizeObserverCallback) => ResizeObserverPort;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  styleId?: string;
}>;

function safely(run: () => void): void {
  try {
    run();
  } catch {
    // Cleanup and layout notifications must not escape the session boundary.
  }
}

export function createKoreaMapSession(options: CreateKoreaMapSessionOptions): KoreaMapSession {
  const renderTimeoutMs = options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(renderTimeoutMs) || renderTimeoutMs <= 0) {
    throw new KoreaMapSessionError('INITIALIZATION_FAILED');
  }

  const schedule = options.setTimeout ?? window.setTimeout.bind(window);
  const cancel = options.clearTimeout ?? window.clearTimeout.bind(window);
  const createResizeObserver =
    options.resizeObserver ?? ((callback: ResizeObserverCallback) => new ResizeObserver(callback));
  const normalizedStyleId = options.styleId?.trim();
  const mapOptions: naver.maps.MapOptions = {
    center: KOREA_MAP_VIEWPORT.center,
    gl: true,
    keyboardShortcuts: true,
    maxZoom: KOREA_MAP_VIEWPORT.maxZoom,
    minZoom: KOREA_MAP_VIEWPORT.minZoom,
    zoom: KOREA_MAP_VIEWPORT.zoom,
    zoomControl: true,
    zoomControlOptions: { position: options.maps.Position.RIGHT_CENTER },
    ...(normalizedStyleId ? { customStyleId: normalizedStyleId } : {}),
  };

  let map: naver.maps.Map;
  try {
    map = new options.maps.Map(options.container, mapOptions);
  } catch {
    throw new KoreaMapSessionError('CONSTRUCTION_FAILED');
  }

  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: KoreaMapSessionError) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  let destroyed = false;
  let initialized = false;
  let settled = false;
  let initListener: naver.maps.MapEventListener | undefined;
  let tilesLoadedListener: naver.maps.MapEventListener | undefined;
  let observer: ResizeObserverPort | undefined;
  let timeoutHandle: number | undefined;
  let viewportListener: naver.maps.MapEventListener | undefined;
  const viewportSubscribers = new Set<(viewport: KoreaMapViewport) => void>();
  const pointLayerDestroyers = new Set<() => void>();

  const readViewport = (): KoreaMapViewport | undefined => {
    if (!initialized || destroyed) {
      return undefined;
    }

    try {
      const bounds = map.getBounds();
      const viewport = {
        maximumLatitude: bounds.maxY(),
        maximumLongitude: bounds.maxX(),
        minimumLatitude: bounds.minY(),
        minimumLongitude: bounds.minX(),
        zoom: map.getZoom(),
      };
      return Object.values(viewport).every(Number.isFinite) &&
        viewport.minimumLatitude < viewport.maximumLatitude &&
        viewport.minimumLongitude < viewport.maximumLongitude
        ? viewport
        : undefined;
    } catch {
      return undefined;
    }
  };

  const publishViewport = () => {
    const viewport = readViewport();
    if (viewport === undefined) {
      return;
    }
    for (const listener of viewportSubscribers) {
      safely(() => listener(viewport));
    }
  };

  const clearRenderWork = () => {
    if (timeoutHandle !== undefined) {
      cancel(timeoutHandle);
      timeoutHandle = undefined;
    }
    if (tilesLoadedListener) {
      const listener = tilesLoadedListener;
      tilesLoadedListener = undefined;
      safely(() => options.maps.Event.removeListener(listener));
    }
  };

  const clearInitWork = () => {
    if (initListener) {
      const listener = initListener;
      initListener = undefined;
      safely(() => options.maps.Event.removeListener(listener));
    }
  };

  const clearSessionWork = () => {
    clearRenderWork();
    clearInitWork();
    if (viewportListener) {
      const listener = viewportListener;
      viewportListener = undefined;
      safely(() => options.maps.Event.removeListener(listener));
    }
    viewportSubscribers.clear();
    for (const destroyPointLayer of [...pointLayerDestroyers]) {
      safely(destroyPointLayer);
    }
    pointLayerDestroyers.clear();
  };

  const terminate = (code: KoreaMapSessionErrorCode) => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    clearSessionWork();
    if (observer) {
      const resizeObserver = observer;
      observer = undefined;
      safely(() => resizeObserver.disconnect());
    }
    if (!settled) {
      settled = true;
      rejectReady(new KoreaMapSessionError(code));
    }
    safely(() => map.destroy());
  };

  const handleInit = () => {
    if (destroyed) {
      return;
    }
    initListener = undefined;
    initialized = true;
    safely(() => map.autoResize());
    safely(() => map.refresh(true));
    publishViewport();
  };

  const handleTilesLoaded = () => {
    if (destroyed || settled) {
      return;
    }
    tilesLoadedListener = undefined;
    settled = true;
    clearRenderWork();
    resolveReady();
  };

  try {
    initListener = options.maps.Event.once(map, 'init', handleInit);
    tilesLoadedListener = options.maps.Event.once(map, 'tilesloaded', handleTilesLoaded);
    observer = createResizeObserver(() => {
      if (!destroyed) {
        safely(() => map.autoResize());
        publishViewport();
      }
    });
    observer.observe(options.container);
    if (!settled) {
      timeoutHandle = schedule(() => terminate('RENDER_TIMEOUT'), renderTimeoutMs);
    }
  } catch {
    destroyed = true;
    clearSessionWork();
    if (observer) {
      safely(() => observer?.disconnect());
    }
    safely(() => map.destroy());
    throw new KoreaMapSessionError('INITIALIZATION_FAILED');
  }

  return {
    createPointLayer: ({ onSelect }) => {
      let layerDestroyed = false;
      let entries: Array<
        Readonly<{
          element: HTMLElement;
          id: string;
          keydownListener: (event: KeyboardEvent) => void;
          marker: naver.maps.Marker;
          selectListener: naver.maps.MapEventListener;
        }>
      > = [];
      let selectedPointId: string | undefined;

      const applySelection = () => {
        for (const entry of entries) {
          const selected = entry.id === selectedPointId;
          entry.element.setAttribute('aria-pressed', String(selected));
          entry.element.dataset.selected = String(selected);
        }
      };

      const cleanupEntries = (ownedEntries: typeof entries) => {
        for (const entry of ownedEntries) {
          safely(() => options.maps.Event.removeListener(entry.selectListener));
          entry.element.removeEventListener('keydown', entry.keydownListener);
          safely(() => entry.marker.setMap(null));
        }
      };

      const clearMarkers = () => {
        cleanupEntries(entries);
        entries = [];
      };

      const destroyPointLayer = () => {
        if (layerDestroyed) {
          return;
        }
        layerDestroyed = true;
        clearMarkers();
        pointLayerDestroyers.delete(destroyPointLayer);
      };
      pointLayerDestroyers.add(destroyPointLayer);

      return {
        destroy: destroyPointLayer,
        replace: (points) => {
          if (layerDestroyed || destroyed) {
            return;
          }
          clearMarkers();
          const nextEntries: typeof entries = [];

          for (const point of points) {
            let element: HTMLElement | undefined;
            let keydownListener: ((event: KeyboardEvent) => void) | undefined;
            let marker: naver.maps.Marker | undefined;
            let selectListener: naver.maps.MapEventListener | undefined;

            try {
              marker = new options.maps.Marker({
                clickable: true,
                map,
                position: new options.maps.LatLng(point.latitude, point.longitude),
                title: point.accessibleName,
              });
              element = marker.getElement();
              element.setAttribute('aria-label', point.accessibleName);
              element.setAttribute('role', 'button');
              element.dataset.bkMapPoint = '';
              element.tabIndex = 0;
              keydownListener = (event: KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                  return;
                }
                event.preventDefault();
                onSelect(point.id);
              };
              element.addEventListener('keydown', keydownListener);
              selectListener = options.maps.Event.addListener(marker, 'click', () => onSelect(point.id));
              nextEntries.push({ element, id: point.id, keydownListener, marker, selectListener });
            } catch {
              if (selectListener !== undefined) {
                const ownedSelectListener = selectListener;
                safely(() => options.maps.Event.removeListener(ownedSelectListener));
              }
              if (element !== undefined && keydownListener !== undefined) {
                element.removeEventListener('keydown', keydownListener);
              }
              if (marker !== undefined) {
                const ownedMarker = marker;
                safely(() => ownedMarker.setMap(null));
              }
              cleanupEntries(nextEntries);
              return;
            }
          }

          entries = nextEntries;
          applySelection();
        },
        select: (id) => {
          if (layerDestroyed || destroyed) {
            return;
          }
          selectedPointId = id;
          applySelection();
        },
      };
    },
    destroy: () => terminate('SESSION_DESTROYED'),
    ready,
    resetView: () => {
      if (!initialized || destroyed) {
        return;
      }
      safely(() => {
        map.setCenter(KOREA_MAP_VIEWPORT.center);
        map.setZoom(KOREA_MAP_VIEWPORT.zoom);
      });
    },
    subscribeViewport: (listener) => {
      if (destroyed) {
        return () => undefined;
      }

      viewportSubscribers.add(listener);
      if (!viewportListener) {
        try {
          viewportListener = options.maps.Event.addListener(map, 'idle', publishViewport);
        } catch {
          viewportSubscribers.delete(listener);
          return () => undefined;
        }
      }
      if (initialized) {
        const viewport = readViewport();
        if (viewport !== undefined) {
          safely(() => listener(viewport));
        }
      }

      return () => {
        viewportSubscribers.delete(listener);
        if (viewportSubscribers.size === 0 && viewportListener) {
          const activeListener = viewportListener;
          viewportListener = undefined;
          safely(() => options.maps.Event.removeListener(activeListener));
        }
      };
    },
  };
}
