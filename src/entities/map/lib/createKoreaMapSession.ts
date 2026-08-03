import type { NaverMapsNamespace } from '../api/loadNaverMapsGl';
import { KOREA_MAP_VIEWPORT } from '../model/map';

const DEFAULT_RENDER_TIMEOUT_MS = 10_000;
export const KOREA_MAP_SESSION_OVERLAY_BUDGET = 240;
export const KOREA_MAP_SESSION_GEOMETRY_VERTEX_BUDGET = 4_000;

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
  keyboardAccessible?: boolean;
  latitude: number;
  longitude: number;
}>;

export type KoreaMapGeometry =
  | Readonly<{ kind: 'area'; ring: readonly (readonly [longitude: number, latitude: number])[] }>
  | Readonly<{ kind: 'line'; path: readonly (readonly [longitude: number, latitude: number])[] }>
  | Readonly<{ kind: 'point'; position: readonly [longitude: number, latitude: number] }>;

export type KoreaMapGeometryFeature = Readonly<{
  accessibleName: string;
  geometry: KoreaMapGeometry;
  id: string;
  keyboardAccessible?: boolean;
}>;

export type KoreaMapLayerReplaceResult =
  | Readonly<{ overlayCount: number; status: 'replaced' | 'unchanged' }>
  | Readonly<{
      overlayCount: number;
      reason:
        | 'GEOMETRY_VERTEX_BUDGET_EXCEEDED'
        | 'INVALID_GEOMETRY'
        | 'OVERLAY_BUDGET_EXCEEDED'
        | 'POINT_BUDGET_EXCEEDED'
        | 'RENDER_FAILED';
      status: 'rejected';
    }>;

export type KoreaMapPointLayer = Readonly<{
  destroy(): void;
  replace(points: readonly KoreaMapPoint[]): KoreaMapLayerReplaceResult;
  select(id: string | undefined): void;
}>;

export type KoreaMapGeometryLayer = Readonly<{
  destroy(): void;
  replace(features: readonly KoreaMapGeometryFeature[]): KoreaMapLayerReplaceResult;
  select(id: string | undefined): void;
}>;

export type KoreaMapSession = Readonly<{
  createGeometryLayer(options: Readonly<{ onSelect: (id: string) => void }>): KoreaMapGeometryLayer;
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
  const layerDestroyers = new Set<() => void>();
  const layerBudgets = new Map<symbol, Readonly<{ geometryVertexCount: number; overlayCount: number }>>();

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
    for (const destroyLayer of [...layerDestroyers]) {
      safely(destroyLayer);
    }
    layerDestroyers.clear();
    layerBudgets.clear();
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

  type MarkerEntry = Readonly<{
    element: HTMLElement;
    id: string;
    keydownListener: (event: KeyboardEvent) => void;
    marker: naver.maps.Marker;
    selectListener: naver.maps.MapEventListener;
  }>;
  type GeometryEntry = Readonly<{
    element?: HTMLElement;
    id: string;
    keydownListener?: (event: KeyboardEvent) => void;
    overlay: naver.maps.Marker | naver.maps.Polygon | naver.maps.Polyline;
    selectListener: naver.maps.MapEventListener;
  }>;

  const currentLayerBudget = (token: symbol) => layerBudgets.get(token) ?? { geometryVertexCount: 0, overlayCount: 0 };

  const canReserveLayerBudget = (token: symbol, overlayCount: number, geometryVertexCount: number): boolean => {
    const current = currentLayerBudget(token);
    let sessionOverlayCount = 0;
    let sessionGeometryVertexCount = 0;
    for (const budget of layerBudgets.values()) {
      sessionOverlayCount += budget.overlayCount;
      sessionGeometryVertexCount += budget.geometryVertexCount;
    }
    return (
      sessionOverlayCount - current.overlayCount + overlayCount <= KOREA_MAP_SESSION_OVERLAY_BUDGET &&
      sessionGeometryVertexCount - current.geometryVertexCount + geometryVertexCount <=
        KOREA_MAP_SESSION_GEOMETRY_VERTEX_BUDGET
    );
  };

  const configureMarkerElement = (
    element: HTMLElement,
    point: Readonly<{ accessibleName: string; keyboardAccessible?: boolean }>,
  ) => {
    element.setAttribute('aria-label', point.accessibleName);
    element.setAttribute('role', 'button');
    element.dataset.bkMapPoint = '';
    element.tabIndex = point.keyboardAccessible === false ? -1 : 0;
  };

  const cleanupMarkerEntries = (entries: readonly MarkerEntry[]) => {
    for (const entry of entries) {
      safely(() => options.maps.Event.removeListener(entry.selectListener));
      entry.element.removeEventListener('keydown', entry.keydownListener);
      safely(() => entry.marker.setMap(null));
    }
  };

  const cleanupGeometryEntries = (entries: readonly GeometryEntry[]) => {
    for (const entry of entries) {
      safely(() => options.maps.Event.removeListener(entry.selectListener));
      if (entry.element !== undefined && entry.keydownListener !== undefined) {
        entry.element.removeEventListener('keydown', entry.keydownListener);
      }
      safely(() => entry.overlay.setMap(null));
    }
  };

  const samePoints = (left: readonly KoreaMapPoint[], right: readonly KoreaMapPoint[]): boolean =>
    left.length === right.length &&
    left.every((point, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        point.accessibleName === candidate.accessibleName &&
        point.id === candidate.id &&
        point.keyboardAccessible === candidate.keyboardAccessible &&
        point.latitude === candidate.latitude &&
        point.longitude === candidate.longitude
      );
    });

  const samePositions = (
    left: readonly (readonly [number, number])[],
    right: readonly (readonly [number, number])[],
  ): boolean =>
    left.length === right.length &&
    left.every((position, index) => position[0] === right[index]?.[0] && position[1] === right[index]?.[1]);

  const sameGeometryFeatures = (
    left: readonly KoreaMapGeometryFeature[],
    right: readonly KoreaMapGeometryFeature[],
  ): boolean =>
    left.length === right.length &&
    left.every((feature, index) => {
      const candidate = right[index];
      if (
        candidate === undefined ||
        feature.accessibleName !== candidate.accessibleName ||
        feature.id !== candidate.id ||
        feature.keyboardAccessible !== candidate.keyboardAccessible ||
        feature.geometry.kind !== candidate.geometry.kind
      ) {
        return false;
      }
      if (feature.geometry.kind === 'point' && candidate.geometry.kind === 'point') {
        return (
          feature.geometry.position[0] === candidate.geometry.position[0] &&
          feature.geometry.position[1] === candidate.geometry.position[1]
        );
      }
      if (feature.geometry.kind === 'line' && candidate.geometry.kind === 'line') {
        return samePositions(feature.geometry.path, candidate.geometry.path);
      }
      return feature.geometry.kind === 'area' && candidate.geometry.kind === 'area'
        ? samePositions(feature.geometry.ring, candidate.geometry.ring)
        : false;
    });

  const isValidPosition = (position: readonly [number, number]): boolean =>
    Number.isFinite(position[0]) && Number.isFinite(position[1]);

  return {
    createGeometryLayer: ({ onSelect }) => {
      const budgetToken = Symbol('geometry-layer');
      layerBudgets.set(budgetToken, { geometryVertexCount: 0, overlayCount: 0 });
      let entries: GeometryEntry[] = [];
      let features: readonly KoreaMapGeometryFeature[] = [];
      let layerDestroyed = false;
      let selectedFeatureId: string | undefined;

      const applySelection = () => {
        for (const entry of entries) {
          if (entry.element === undefined) {
            continue;
          }
          const selected = entry.id === selectedFeatureId;
          entry.element.setAttribute('aria-pressed', String(selected));
          entry.element.dataset.selected = String(selected);
        }
      };

      const destroyGeometryLayer = () => {
        if (layerDestroyed) {
          return;
        }
        layerDestroyed = true;
        cleanupGeometryEntries(entries);
        entries = [];
        features = [];
        layerBudgets.delete(budgetToken);
        layerDestroyers.delete(destroyGeometryLayer);
      };
      layerDestroyers.add(destroyGeometryLayer);

      return {
        destroy: destroyGeometryLayer,
        replace: (nextFeatures) => {
          const current = currentLayerBudget(budgetToken);
          if (layerDestroyed || destroyed) {
            return { overlayCount: current.overlayCount, reason: 'RENDER_FAILED', status: 'rejected' };
          }
          if (sameGeometryFeatures(features, nextFeatures)) {
            return { overlayCount: current.overlayCount, status: 'unchanged' };
          }

          let geometryVertexCount = 0;
          let validGeometry = true;
          for (const feature of nextFeatures) {
            if (feature.geometry.kind === 'point') {
              geometryVertexCount += 1;
              validGeometry &&= isValidPosition(feature.geometry.position);
            } else if (feature.geometry.kind === 'line') {
              geometryVertexCount += feature.geometry.path.length;
              validGeometry &&= feature.geometry.path.length >= 2 && feature.geometry.path.every(isValidPosition);
            } else {
              geometryVertexCount += feature.geometry.ring.length;
              validGeometry &&= feature.geometry.ring.length >= 3 && feature.geometry.ring.every(isValidPosition);
            }
          }
          if (!validGeometry) {
            return { overlayCount: current.overlayCount, reason: 'INVALID_GEOMETRY', status: 'rejected' };
          }
          if (geometryVertexCount > KOREA_MAP_SESSION_GEOMETRY_VERTEX_BUDGET) {
            return {
              overlayCount: current.overlayCount,
              reason: 'GEOMETRY_VERTEX_BUDGET_EXCEEDED',
              status: 'rejected',
            };
          }
          if (!canReserveLayerBudget(budgetToken, nextFeatures.length, geometryVertexCount)) {
            return { overlayCount: current.overlayCount, reason: 'OVERLAY_BUDGET_EXCEEDED', status: 'rejected' };
          }

          const nextEntries: GeometryEntry[] = [];
          let pendingElement: HTMLElement | undefined;
          let pendingKeydownListener: ((event: KeyboardEvent) => void) | undefined;
          let pendingOverlay: naver.maps.Marker | naver.maps.Polygon | naver.maps.Polyline | undefined;
          let pendingSelectListener: naver.maps.MapEventListener | undefined;
          try {
            for (const feature of nextFeatures) {
              let overlay: naver.maps.Marker | naver.maps.Polygon | naver.maps.Polyline;
              let element: HTMLElement | undefined;
              let keydownListener: ((event: KeyboardEvent) => void) | undefined;
              if (feature.geometry.kind === 'point') {
                const [longitude, latitude] = feature.geometry.position;
                const marker = new options.maps.Marker({
                  clickable: true,
                  map,
                  position: new options.maps.LatLng(latitude, longitude),
                  title: feature.accessibleName,
                });
                overlay = marker;
                pendingOverlay = marker;
                element = marker.getElement();
                pendingElement = element;
                configureMarkerElement(element, feature);
                keydownListener = (event: KeyboardEvent) => {
                  if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                  }
                  event.preventDefault();
                  onSelect(feature.id);
                };
                pendingKeydownListener = keydownListener;
                element.addEventListener('keydown', keydownListener);
              } else if (feature.geometry.kind === 'line') {
                overlay = new options.maps.Polyline({
                  clickable: true,
                  map,
                  path: feature.geometry.path.map(
                    ([longitude, latitude]) => new options.maps.LatLng(latitude, longitude),
                  ),
                });
                pendingOverlay = overlay;
              } else {
                overlay = new options.maps.Polygon({
                  clickable: true,
                  map,
                  paths: [
                    feature.geometry.ring.map(([longitude, latitude]) => new options.maps.LatLng(latitude, longitude)),
                  ],
                });
                pendingOverlay = overlay;
              }
              pendingSelectListener = options.maps.Event.addListener(overlay, 'click', () => onSelect(feature.id));
              nextEntries.push({
                ...(element === undefined ? {} : { element }),
                id: feature.id,
                ...(keydownListener === undefined ? {} : { keydownListener }),
                overlay,
                selectListener: pendingSelectListener,
              });
              pendingElement = undefined;
              pendingKeydownListener = undefined;
              pendingOverlay = undefined;
              pendingSelectListener = undefined;
            }
          } catch {
            if (pendingSelectListener !== undefined) {
              const listener = pendingSelectListener;
              safely(() => options.maps.Event.removeListener(listener));
            }
            if (pendingElement !== undefined && pendingKeydownListener !== undefined) {
              pendingElement.removeEventListener('keydown', pendingKeydownListener);
            }
            if (pendingOverlay !== undefined) {
              safely(() => pendingOverlay?.setMap(null));
            }
            cleanupGeometryEntries(nextEntries);
            return { overlayCount: current.overlayCount, reason: 'RENDER_FAILED', status: 'rejected' };
          }

          const previousEntries = entries;
          entries = nextEntries;
          features = nextFeatures.map((feature) => feature);
          layerBudgets.set(budgetToken, { geometryVertexCount, overlayCount: nextFeatures.length });
          applySelection();
          cleanupGeometryEntries(previousEntries);
          return { overlayCount: nextFeatures.length, status: 'replaced' };
        },
        select: (id) => {
          if (layerDestroyed || destroyed) {
            return;
          }
          selectedFeatureId = id;
          applySelection();
        },
      };
    },
    createPointLayer: ({ onSelect }) => {
      const budgetToken = Symbol('point-layer');
      layerBudgets.set(budgetToken, { geometryVertexCount: 0, overlayCount: 0 });
      let entries: MarkerEntry[] = [];
      let layerDestroyed = false;
      let points: readonly KoreaMapPoint[] = [];
      let selectedPointId: string | undefined;

      const applySelection = () => {
        for (const entry of entries) {
          const selected = entry.id === selectedPointId;
          entry.element.setAttribute('aria-pressed', String(selected));
          entry.element.dataset.selected = String(selected);
        }
      };

      const destroyPointLayer = () => {
        if (layerDestroyed) {
          return;
        }
        layerDestroyed = true;
        cleanupMarkerEntries(entries);
        entries = [];
        points = [];
        layerBudgets.delete(budgetToken);
        layerDestroyers.delete(destroyPointLayer);
      };
      layerDestroyers.add(destroyPointLayer);

      return {
        destroy: destroyPointLayer,
        replace: (nextPoints) => {
          const current = currentLayerBudget(budgetToken);
          if (layerDestroyed || destroyed) {
            return { overlayCount: current.overlayCount, reason: 'RENDER_FAILED', status: 'rejected' };
          }
          if (samePoints(points, nextPoints)) {
            return { overlayCount: current.overlayCount, status: 'unchanged' };
          }
          if (
            nextPoints.length > KOREA_MAP_SESSION_OVERLAY_BUDGET ||
            !canReserveLayerBudget(budgetToken, nextPoints.length, 0)
          ) {
            return { overlayCount: current.overlayCount, reason: 'POINT_BUDGET_EXCEEDED', status: 'rejected' };
          }

          const nextEntries: MarkerEntry[] = [];
          let pendingElement: HTMLElement | undefined;
          let pendingKeydownListener: ((event: KeyboardEvent) => void) | undefined;
          let pendingMarker: naver.maps.Marker | undefined;
          let pendingSelectListener: naver.maps.MapEventListener | undefined;
          try {
            for (const point of nextPoints) {
              if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
                throw new TypeError('Invalid point coordinate');
              }
              const marker = new options.maps.Marker({
                clickable: true,
                map,
                position: new options.maps.LatLng(point.latitude, point.longitude),
                title: point.accessibleName,
              });
              pendingMarker = marker;
              const element = marker.getElement();
              pendingElement = element;
              configureMarkerElement(element, point);
              const keydownListener = (event: KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                  return;
                }
                event.preventDefault();
                onSelect(point.id);
              };
              pendingKeydownListener = keydownListener;
              element.addEventListener('keydown', keydownListener);
              pendingSelectListener = options.maps.Event.addListener(marker, 'click', () => onSelect(point.id));
              nextEntries.push({
                element,
                id: point.id,
                keydownListener,
                marker,
                selectListener: pendingSelectListener,
              });
              pendingElement = undefined;
              pendingKeydownListener = undefined;
              pendingMarker = undefined;
              pendingSelectListener = undefined;
            }
          } catch {
            if (pendingSelectListener !== undefined) {
              const listener = pendingSelectListener;
              safely(() => options.maps.Event.removeListener(listener));
            }
            if (pendingElement !== undefined && pendingKeydownListener !== undefined) {
              pendingElement.removeEventListener('keydown', pendingKeydownListener);
            }
            if (pendingMarker !== undefined) {
              safely(() => pendingMarker?.setMap(null));
            }
            cleanupMarkerEntries(nextEntries);
            return { overlayCount: current.overlayCount, reason: 'RENDER_FAILED', status: 'rejected' };
          }

          const previousEntries = entries;
          entries = nextEntries;
          points = nextPoints.map((point) => point);
          layerBudgets.set(budgetToken, { geometryVertexCount: 0, overlayCount: nextPoints.length });
          applySelection();
          cleanupMarkerEntries(previousEntries);
          return { overlayCount: nextPoints.length, status: 'replaced' };
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
