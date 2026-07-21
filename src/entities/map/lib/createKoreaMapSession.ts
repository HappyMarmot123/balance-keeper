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

export type KoreaMapSession = Readonly<{
  destroy(): void;
  ready: Promise<void>;
  resetView(): void;
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
  };
}
