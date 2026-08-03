import type { KoreaMapGeometryFeature, KoreaMapPoint, KoreaMapSession } from '../../../entities/map';
import type { MapLayerItem } from '../model/mapLayerItems';
import type { KoreaMapLayerId } from '../model/mapLayerRegistry';
import type { MapLayerSelection, ResolvedMapLayerRuntime } from '../model/mapLayerRuntime';
import { MapGeometryLayerOverlay, type MapLayerRejectionReason, MapPointLayerOverlay } from './MapLayerOverlay';

type KoreaMapLayerOverlaysProps = Readonly<{
  onAccepted: (runtime: ResolvedMapLayerRuntime) => void;
  onRejected: (layerId: KoreaMapLayerId, reason: MapLayerRejectionReason) => void;
  onSelect: (layerId: KoreaMapLayerId, itemId: string) => void;
  railLayerId?: KoreaMapLayerId;
  retryVersions: ReadonlyMap<KoreaMapLayerId, number>;
  runtimes: readonly ResolvedMapLayerRuntime[];
  selection?: MapLayerSelection;
  session: KoreaMapSession;
}>;

function toPoint(item: MapLayerItem): KoreaMapPoint | undefined {
  if (item.geometry.kind !== 'point') {
    return undefined;
  }

  return {
    accessibleName: item.accessibleName,
    id: item.id,
    latitude: item.geometry.position[1],
    longitude: item.geometry.position[0],
  };
}

function toGeometryFeature(item: MapLayerItem): KoreaMapGeometryFeature {
  return {
    accessibleName: item.accessibleName,
    geometry: item.geometry,
    id: item.id,
  };
}

export function KoreaMapLayerOverlays({
  onAccepted,
  onRejected,
  onSelect,
  railLayerId,
  retryVersions,
  runtimes,
  selection,
  session,
}: KoreaMapLayerOverlaysProps) {
  return (
    <>
      {runtimes.map((runtime) => {
        if (runtime.overlayItems.length === 0) {
          return null;
        }

        const sharedProps = {
          keyboardAccessible: railLayerId === runtime.id,
          onAccepted: () => onAccepted(runtime),
          onRejected: (reason: MapLayerRejectionReason) => onRejected(runtime.id, reason),
          onSelect: (itemId: string) => onSelect(runtime.id, itemId),
          retryVersion: retryVersions.get(runtime.id) ?? 0,
          selectedId: selection?.layerId === runtime.id ? selection.itemId : undefined,
          session,
        } as const;

        return runtime.renderer === 'geometry' ? (
          <MapGeometryLayerOverlay
            items={runtime.overlayItems.map(toGeometryFeature)}
            key={runtime.id}
            {...sharedProps}
          />
        ) : (
          <MapPointLayerOverlay
            items={runtime.overlayItems.flatMap((item) => {
              const point = toPoint(item);
              return point === undefined ? [] : [point];
            })}
            key={runtime.id}
            {...sharedProps}
          />
        );
      })}
    </>
  );
}
