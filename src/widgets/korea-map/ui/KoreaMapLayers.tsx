import type { ComponentType } from 'preact';

import { useEffect, useRef, useState } from 'preact/hooks';

import type { CctvBounds, CctvCamera } from '../../../entities/cctv';
import type { KoreaMapSession, KoreaMapViewport } from '../../../entities/map';
import type { KoreaMapLayerId } from '../model/mapLayerRegistry';
import type { MapLayerSelection, ResolvedMapLayerRuntime } from '../model/mapLayerRuntime';
import { useKoreaMapLayerRuntimes } from '../model/useKoreaMapLayerRuntimes';
import { KoreaMapLayerOverlays } from './KoreaMapLayerOverlays';
import { MapLayerControls } from './MapLayerControls';
import { MapLayerDetail } from './MapLayerDetail';
import type { MapLayerRejectionReason } from './MapLayerOverlay';
import { MapLayerRail } from './MapLayerRail';

type AcceptedLayerPresentation = Readonly<{
  cctvSnapshot?: NonNullable<ReturnType<typeof useKoreaMapLayerRuntimes>['cctvSnapshot']>;
  runtime: ResolvedMapLayerRuntime;
}>;

type CctvLivePanelProps = Readonly<{
  bounds: CctvBounds;
  camera: CctvCamera;
  onClose: () => void;
}>;

type CctvLivePanelComponent = ComponentType<CctvLivePanelProps>;

const sameViewport = (left: KoreaMapViewport | undefined, right: KoreaMapViewport | undefined): boolean =>
  left?.maximumLatitude === right?.maximumLatitude &&
  left?.maximumLongitude === right?.maximumLongitude &&
  left?.minimumLatitude === right?.minimumLatitude &&
  left?.minimumLongitude === right?.minimumLongitude &&
  left?.zoom === right?.zoom;

export function KoreaMapLayers({ session }: Readonly<{ session: KoreaMapSession }>) {
  const [activeLayerIds, setActiveLayerIds] = useState<ReadonlySet<KoreaMapLayerId>>(() => new Set());
  const [railLayerId, setRailLayerId] = useState<KoreaMapLayerId>();
  const [selection, setSelection] = useState<MapLayerSelection>();
  const [restoreFocusKey, setRestoreFocusKey] = useState<string>();
  const [sessionRejections, setSessionRejections] = useState<ReadonlyMap<KoreaMapLayerId, MapLayerRejectionReason>>(
    () => new Map(),
  );
  const [sessionRetryVersions, setSessionRetryVersions] = useState<ReadonlyMap<KoreaMapLayerId, number>>(
    () => new Map(),
  );
  const [viewport, setViewport] = useState<KoreaMapViewport>();
  const [LazyCctvLivePanel, setLazyCctvLivePanel] = useState<CctvLivePanelComponent | null>(null);
  const cctvPanelImportRef = useRef(false);
  const viewportFrameRef = useRef<number>();
  const pendingViewportRef = useRef<KoreaMapViewport>();
  const previousViewportRef = useRef<KoreaMapViewport>();
  const acceptedPresentationsRef = useRef(new Map<KoreaMapLayerId, AcceptedLayerPresentation>());

  const loadCctvPanel = () => {
    if (LazyCctvLivePanel !== null || cctvPanelImportRef.current) {
      return;
    }
    cctvPanelImportRef.current = true;
    void import('./CctvLivePanel').then((module) => {
      cctvPanelImportRef.current = false;
      setLazyCctvLivePanel(() => module.CctvLivePanel);
    });
  };

  useEffect(() => {
    const unsubscribe = session.subscribeViewport((nextViewport) => {
      pendingViewportRef.current = nextViewport;
      if (viewportFrameRef.current !== undefined) {
        return;
      }
      viewportFrameRef.current = window.requestAnimationFrame(() => {
        viewportFrameRef.current = undefined;
        const candidate = pendingViewportRef.current;
        pendingViewportRef.current = undefined;
        if (sameViewport(candidate, previousViewportRef.current)) {
          return;
        }
        previousViewportRef.current = candidate;
        if (candidate === undefined) {
          return;
        }
        setViewport(candidate);
      });
    });

    return () => {
      if (viewportFrameRef.current !== undefined) {
        window.cancelAnimationFrame(viewportFrameRef.current);
        viewportFrameRef.current = undefined;
      }
      unsubscribe();
    };
  }, [session]);

  const { cctvSnapshot, runtimes } = useKoreaMapLayerRuntimes(activeLayerIds, viewport);
  const presentedRuntimes = runtimes.map((runtime) =>
    sessionRejections.has(runtime.id) && runtime.overlayItems.length > 0
      ? (acceptedPresentationsRef.current.get(runtime.id)?.runtime ?? { ...runtime, overlayItems: [] })
      : runtime,
  );
  const activeRuntimes = presentedRuntimes.filter((runtime) => activeLayerIds.has(runtime.id));
  const railRuntime = activeRuntimes.find((runtime) => runtime.id === railLayerId) ?? activeRuntimes[0];

  useEffect(() => {
    const nonRenderableLayerIds = runtimes
      .filter((runtime) => runtime.overlayItems.length === 0)
      .map((runtime) => runtime.id);
    if (nonRenderableLayerIds.length === 0) {
      return;
    }

    for (const id of nonRenderableLayerIds) {
      acceptedPresentationsRef.current.delete(id);
    }
    setSessionRejections((current) => {
      const remaining = new Map(current);
      let changed = false;
      for (const id of nonRenderableLayerIds) {
        changed = remaining.delete(id) || changed;
      }
      return changed ? remaining : current;
    });
  }, [runtimes]);

  useEffect(() => {
    if (railRuntime !== undefined && railLayerId !== railRuntime.id) {
      setRailLayerId(railRuntime.id);
    }
  }, [railLayerId, railRuntime]);

  useEffect(() => {
    if (selection === undefined) {
      return;
    }
    const selectedRuntime = presentedRuntimes.find((runtime) => runtime.id === selection.layerId);
    if (selectedRuntime?.overlayItems.some((item) => item.id === selection.itemId) !== true) {
      setSelection(undefined);
    }
  }, [presentedRuntimes, selection]);

  const toggleLayer = (id: KoreaMapLayerId) => {
    setActiveLayerIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        acceptedPresentationsRef.current.delete(id);
        setSessionRejections((rejections) => {
          const remaining = new Map(rejections);
          remaining.delete(id);
          return remaining;
        });
        setSessionRetryVersions((versions) => {
          if (!versions.has(id)) {
            return versions;
          }
          const remaining = new Map(versions);
          remaining.delete(id);
          return remaining;
        });
        if (selection?.layerId === id) {
          setSelection(undefined);
        }
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const retrySessionLayer = (id: KoreaMapLayerId) => {
    setSessionRetryVersions((current) => new Map(current).set(id, (current.get(id) ?? 0) + 1));
  };
  const selectItem = (layerId: KoreaMapLayerId, itemId: string) => {
    setRestoreFocusKey(`${layerId}:${itemId}`);
    setRailLayerId(layerId);
    setSelection({ itemId, layerId });
  };
  const closeSelection = () => setSelection(undefined);

  const selectedRuntime =
    selection === undefined ? undefined : presentedRuntimes.find(({ id }) => id === selection.layerId);
  const selectedItem = selectedRuntime?.overlayItems.find(({ id }) => id === selection?.itemId);
  const currentCctvRuntime = runtimes.find(({ id }) => id === 'cctv');
  const presentedCctvSnapshot =
    sessionRejections.has('cctv') && currentCctvRuntime !== undefined && currentCctvRuntime.overlayItems.length > 0
      ? acceptedPresentationsRef.current.get('cctv')?.cctvSnapshot
      : cctvSnapshot;
  const selectedCamera =
    selection?.layerId === 'cctv'
      ? presentedCctvSnapshot?.cameras.find((camera) => camera.id === selection.itemId)
      : undefined;
  const selectedCameraLayerId = selectedCamera?.id ?? null;

  useEffect(() => {
    if (selectedCameraLayerId !== null && presentedCctvSnapshot !== undefined) {
      loadCctvPanel();
    }
  }, [presentedCctvSnapshot, selectedCameraLayerId]);

  return (
    <>
      <div className="pointer-events-none absolute right-4 top-4 z-30">
        <MapLayerControls activeLayerIds={activeLayerIds} onReset={() => session.resetView()} onToggle={toggleLayer} />
      </div>

      <KoreaMapLayerOverlays
        onAccepted={(runtime) => {
          acceptedPresentationsRef.current.set(runtime.id, {
            ...(runtime.id === 'cctv' && cctvSnapshot !== undefined ? { cctvSnapshot } : {}),
            runtime,
          });
          setSessionRejections((current) => {
            if (!current.has(runtime.id)) {
              return current;
            }
            const remaining = new Map(current);
            remaining.delete(runtime.id);
            return remaining;
          });
        }}
        onRejected={(layerId, reason) => {
          setSessionRejections((current) =>
            current.get(layerId) === reason ? current : new Map(current).set(layerId, reason),
          );
        }}
        onSelect={selectItem}
        railLayerId={railRuntime?.id}
        retryVersions={sessionRetryVersions}
        runtimes={runtimes}
        selection={selection}
        session={session}
      />

      {railRuntime !== undefined && (
        <MapLayerRail
          activeRuntimes={activeRuntimes}
          onFocusRestored={() => setRestoreFocusKey(undefined)}
          onRailLayerChange={(id) => {
            setSelection(undefined);
            setRailLayerId(id);
          }}
          onRetrySessionLayer={retrySessionLayer}
          onSelect={selectItem}
          railRuntime={railRuntime}
          restoreFocusKey={restoreFocusKey}
          selection={selection}
          sessionRejections={sessionRejections}
        />
      )}

      {selectedCamera !== undefined && presentedCctvSnapshot !== undefined && LazyCctvLivePanel !== null && (
        <LazyCctvLivePanel
          bounds={presentedCctvSnapshot.bounds}
          camera={selectedCamera}
          key={selectedCamera.id}
          onClose={closeSelection}
        />
      )}
      {selectedItem !== undefined && selection?.layerId !== 'cctv' && (
        <MapLayerDetail item={selectedItem} onClose={closeSelection} />
      )}
    </>
  );
}
