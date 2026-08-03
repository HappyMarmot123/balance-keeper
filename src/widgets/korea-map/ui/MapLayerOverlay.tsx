import { useEffect, useMemo, useRef } from 'preact/hooks';

import type {
  KoreaMapGeometryFeature,
  KoreaMapGeometryLayer,
  KoreaMapLayerReplaceResult,
  KoreaMapPoint,
  KoreaMapPointLayer,
  KoreaMapSession,
} from '../../../entities/map';

export type MapLayerRejectionReason = Extract<KoreaMapLayerReplaceResult, { status: 'rejected' }>['reason'];

type MapLayerOverlayControlProps = Readonly<{
  keyboardAccessible?: boolean;
  onAccepted?: () => void;
  onRejected?: (reason: MapLayerRejectionReason) => void;
  onSelect: (id: string) => void;
  retryVersion?: number;
  selectedId?: string;
  session: KoreaMapSession;
}>;

type MapPointLayerOverlayProps = MapLayerOverlayControlProps &
  Readonly<{
    items: readonly KoreaMapPoint[];
  }>;

type MapGeometryLayerOverlayProps = MapLayerOverlayControlProps &
  Readonly<{
    items: readonly KoreaMapGeometryFeature[];
  }>;

export function MapPointLayerOverlay({
  items,
  keyboardAccessible,
  onAccepted,
  onRejected,
  onSelect,
  retryVersion = 0,
  selectedId,
  session,
}: MapPointLayerOverlayProps) {
  const layerRef = useRef<KoreaMapPointLayer>();
  const onAcceptedRef = useRef(onAccepted);
  const onRejectedRef = useRef(onRejected);
  const onSelectRef = useRef(onSelect);
  onAcceptedRef.current = onAccepted;
  onRejectedRef.current = onRejected;
  onSelectRef.current = onSelect;
  const controlledItems = useMemo(
    () => (keyboardAccessible === undefined ? items : items.map((item) => ({ ...item, keyboardAccessible }))),
    [items, keyboardAccessible],
  );
  const controlledItemsSignature = useMemo(() => JSON.stringify(controlledItems), [controlledItems]);

  useEffect(() => {
    const layer = session.createPointLayer({ onSelect: (id) => onSelectRef.current(id) });
    layerRef.current = layer;
    return () => {
      layer.destroy();
      if (layerRef.current === layer) {
        layerRef.current = undefined;
      }
    };
  }, [session]);

  useEffect(() => {
    const result = layerRef.current?.replace(controlledItems);
    if (result?.status === 'rejected') {
      onRejectedRef.current?.(result.reason);
    } else if (result !== undefined) {
      onAcceptedRef.current?.();
    }
  }, [controlledItemsSignature, retryVersion, session]);

  useEffect(() => {
    layerRef.current?.select(selectedId);
  }, [selectedId, session]);

  return null;
}

export function MapGeometryLayerOverlay({
  items,
  keyboardAccessible,
  onAccepted,
  onRejected,
  onSelect,
  retryVersion = 0,
  selectedId,
  session,
}: MapGeometryLayerOverlayProps) {
  const layerRef = useRef<KoreaMapGeometryLayer>();
  const onAcceptedRef = useRef(onAccepted);
  const onRejectedRef = useRef(onRejected);
  const onSelectRef = useRef(onSelect);
  onAcceptedRef.current = onAccepted;
  onRejectedRef.current = onRejected;
  onSelectRef.current = onSelect;
  const controlledItems = useMemo(
    () => (keyboardAccessible === undefined ? items : items.map((item) => ({ ...item, keyboardAccessible }))),
    [items, keyboardAccessible],
  );
  const controlledItemsSignature = useMemo(() => JSON.stringify(controlledItems), [controlledItems]);

  useEffect(() => {
    const layer = session.createGeometryLayer({ onSelect: (id) => onSelectRef.current(id) });
    layerRef.current = layer;
    return () => {
      layer.destroy();
      if (layerRef.current === layer) {
        layerRef.current = undefined;
      }
    };
  }, [session]);

  useEffect(() => {
    const result = layerRef.current?.replace(controlledItems);
    if (result?.status === 'rejected') {
      onRejectedRef.current?.(result.reason);
    } else if (result !== undefined) {
      onAcceptedRef.current?.();
    }
  }, [controlledItemsSignature, retryVersion, session]);

  useEffect(() => {
    layerRef.current?.select(selectedId);
  }, [selectedId, session]);

  return null;
}
