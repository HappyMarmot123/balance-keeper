import { useQuery } from '@tanstack/preact-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type CctvBounds, cctvListQueryOptions } from '../../../entities/cctv';
import type { KoreaMapPointLayer, KoreaMapSession, KoreaMapViewport } from '../../../entities/map';
import { isAppError } from '../../../shared/contracts';
import { CCTV_POINT_BUDGET, resolveCctvBounds } from '../model/cctvViewport';
import { CctvStillPanel } from './CctvStillPanel';

const cctvFreshnessFormatter = new Intl.DateTimeFormat('ko-KR', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
});

function CctvDataLayer({ bounds, session }: Readonly<{ bounds: CctvBounds; session: KoreaMapSession }>) {
  const query = useQuery(cctvListQueryOptions(bounds, { enabled: true }));
  const cameraButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRailRef = useRef<HTMLElement>(null);
  const pointLayerRef = useRef<KoreaMapPointLayer>();
  const restoreFocusCameraIdRef = useRef<string>();
  const [selectedCameraId, setSelectedCameraId] = useState<string>();
  const selectCamera = useCallback((cameraId: string) => {
    restoreFocusCameraIdRef.current = cameraId;
    setSelectedCameraId(cameraId);
  }, []);

  useEffect(() => {
    const layer = session.createPointLayer({ onSelect: selectCamera });
    pointLayerRef.current = layer;
    return () => {
      layer.destroy();
      if (pointLayerRef.current === layer) {
        pointLayerRef.current = undefined;
      }
    };
  }, [selectCamera, session]);

  const cameras = useMemo(() => query.data?.data.cameras.slice(0, CCTV_POINT_BUDGET) ?? [], [query.data?.data.cameras]);
  const selectedCamera = cameras.find((camera) => camera.id === selectedCameraId);

  useEffect(() => {
    pointLayerRef.current?.replace(
      cameras.map((camera) => ({
        accessibleName: `${camera.name} 정지영상 보기`,
        id: camera.id,
        latitude: camera.latitude,
        longitude: camera.longitude,
      })),
    );
  }, [cameras]);

  useEffect(() => {
    pointLayerRef.current?.select(selectedCameraId);
  }, [selectedCameraId]);

  useEffect(() => {
    if (selectedCameraId === undefined && restoreFocusCameraIdRef.current !== undefined) {
      cameraButtonRefs.current.get(restoreFocusCameraIdRef.current)?.focus();
    }
  }, [selectedCameraId]);

  useEffect(() => {
    if (selectedCameraId === undefined || selectedCamera !== undefined) {
      return;
    }
    restoreFocusCameraIdRef.current = undefined;
    setSelectedCameraId(undefined);
    const firstCamera = cameras[0];
    if (firstCamera === undefined) {
      listRailRef.current?.focus();
    } else {
      cameraButtonRefs.current.get(firstCamera.id)?.focus();
    }
  }, [cameras, selectedCamera, selectedCameraId]);

  if (query.isPending) {
    return (
      <aside className="absolute left-4 right-16 top-44 z-10 max-w-sm border border-boundary bg-surface-raised px-3 py-2 lg:right-auto lg:top-24">
        <p className="text-sm text-foreground" role="status">
          CCTV 위치를 불러오는 중입니다.
        </p>
      </aside>
    );
  }

  if (query.data === undefined) {
    if (isAppError(query.error) && query.error.code === 'MISSING_CREDENTIALS') {
      return (
        <aside className="absolute left-4 right-16 top-44 z-10 max-w-sm border border-boundary bg-surface-raised px-3 py-2 lg:right-auto lg:top-24">
          <p className="text-sm text-foreground" role="status">
            CCTV 연결 설정이 필요합니다. 관리자에게 문의하세요.
          </p>
        </aside>
      );
    }

    return (
      <aside
        className="absolute left-4 right-16 top-44 z-10 grid max-w-sm gap-3 border border-boundary bg-surface-raised px-3 py-2 lg:right-auto lg:top-24"
        role="alert"
      >
        <p className="text-sm text-foreground">CCTV 위치를 불러오지 못했습니다.</p>
        <button
          className="w-fit rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={() => void query.refetch()}
          type="button"
        >
          CCTV 위치 다시 시도
        </button>
      </aside>
    );
  }

  return (
    <>
      <aside
        aria-label="현재 화면 CCTV 목록"
        className={
          selectedCamera === undefined
            ? 'absolute left-4 right-16 top-44 z-10 max-h-96 overflow-hidden border border-boundary bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:right-auto lg:top-24 lg:w-80'
            : 'absolute left-4 right-16 top-44 z-10 hidden max-h-96 overflow-hidden border border-boundary bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:right-auto lg:top-24 lg:block lg:w-80'
        }
        ref={listRailRef}
        tabIndex={-1}
      >
        <div className="border-b border-boundary px-3 py-2">
          <p className="font-data text-xs font-semibold text-foreground">
            현재 화면 · {query.data.data.cameras.length}대
          </p>
          <time
            className="mt-1 block font-data text-xs text-muted"
            dateTime={new Date(query.data.meta.fetchedAt).toISOString()}
          >
            <span>{query.data.meta.source}</span>
            <span> · {cctvFreshnessFormatter.format(query.data.meta.fetchedAt)} 수집</span>
          </time>
          {query.data.meta.cache === 'STALE' && (
            <p className="mt-1 text-xs text-muted" role="status">
              마지막으로 확인된 CCTV 위치입니다.
            </p>
          )}
          {query.error !== null && (
            <p className="mt-1 text-xs text-muted" role="status">
              CCTV 위치 갱신에 실패해 마지막 결과를 표시합니다.
            </p>
          )}
          {query.data.data.cameras.length > cameras.length && (
            <p className="mt-1 text-xs text-muted">{cameras.length}대만 표시합니다. 지도를 더 확대하세요.</p>
          )}
        </div>
        {cameras.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted" role="status">
            현재 화면에 제공되는 CCTV가 없습니다.
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto p-2">
            {cameras.map((camera) => (
              <li key={camera.id}>
                <button
                  aria-label={`${camera.name} 정지영상 보기`}
                  aria-pressed={selectedCameraId === camera.id}
                  className={
                    selectedCameraId === camera.id
                      ? 'w-full border-b border-l-2 border-boundary border-l-accent bg-surface-inset px-2 py-2 text-left text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                      : 'w-full border-b border-boundary px-2 py-2 text-left text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                  }
                  onClick={() => selectCamera(camera.id)}
                  ref={(element) => {
                    if (element === null) {
                      cameraButtonRefs.current.delete(camera.id);
                    } else {
                      cameraButtonRefs.current.set(camera.id, element);
                    }
                  }}
                  type="button"
                >
                  <span className="block break-words font-semibold">{camera.name}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {camera.roadType === 'expressway' ? '고속도로' : '국도'} · 정지영상 보기
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      {selectedCamera !== undefined && (
        <CctvStillPanel
          bounds={query.data.data.bounds}
          camera={selectedCamera}
          key={selectedCamera.id}
          onClose={() => setSelectedCameraId(undefined)}
        />
      )}
    </>
  );
}

export function CctvMapLayer({ active, session }: Readonly<{ active: boolean; session: KoreaMapSession }>) {
  const [viewport, setViewport] = useState<KoreaMapViewport>();

  useEffect(() => {
    if (!active) {
      setViewport(undefined);
      return;
    }
    return session.subscribeViewport(setViewport);
  }, [active, session]);

  if (!active) {
    return null;
  }

  const bounds = viewport === undefined ? undefined : resolveCctvBounds(viewport);
  if (bounds !== undefined) {
    const boundsKey = [
      bounds.minimumLongitude,
      bounds.minimumLatitude,
      bounds.maximumLongitude,
      bounds.maximumLatitude,
    ].join(':');
    return <CctvDataLayer bounds={bounds} key={boundsKey} session={session} />;
  }

  return (
    <aside className="absolute left-4 right-16 top-44 z-10 max-w-sm border border-boundary bg-surface-raised px-3 py-2 lg:right-auto lg:top-24">
      <p className="text-sm text-foreground" role="status">
        지도를 확대하면 CCTV 위치를 표시합니다.
      </p>
    </aside>
  );
}
