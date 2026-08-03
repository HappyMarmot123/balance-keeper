import { useEffect, useMemo, useRef } from 'preact/hooks';

import type {
  KoreaMapGeometry,
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

function sameKeyboardAccessible(left: boolean | undefined, right: boolean | undefined): boolean {
  return left === right;
}

function samePoints(left: readonly KoreaMapPoint[], right: readonly KoreaMapPoint[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((point, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      point.accessibleName === candidate.accessibleName &&
      point.id === candidate.id &&
      sameKeyboardAccessible(point.keyboardAccessible, candidate.keyboardAccessible) &&
      point.latitude === candidate.latitude &&
      point.longitude === candidate.longitude
    );
  });
}

type KoreaMapLineGeometry = Extract<KoreaMapGeometry, Readonly<{ kind: 'line' }>>;
type KoreaMapAreaGeometry = Extract<KoreaMapGeometry, Readonly<{ kind: 'area' }>>;
type KoreaMapPointGeometry = Extract<KoreaMapGeometry, Readonly<{ kind: 'point' }>>;

function samePointsGeometry(left: KoreaMapPointGeometry, right: KoreaMapPointGeometry): boolean {
  return left.position[0] === right.position[0] && left.position[1] === right.position[1];
}

function sameLineGeometry(left: KoreaMapLineGeometry, right: KoreaMapLineGeometry): boolean {
  return (
    left.path.length === right.path.length &&
    left.path.every(
      (position, pointIndex) =>
        position[0] === right.path[pointIndex]?.[0] && position[1] === right.path[pointIndex]?.[1],
    )
  );
}

function sameAreaGeometry(left: KoreaMapAreaGeometry, right: KoreaMapAreaGeometry): boolean {
  return (
    left.ring.length === right.ring.length &&
    left.ring.every(
      (position, pointIndex) =>
        position[0] === right.ring[pointIndex]?.[0] && position[1] === right.ring[pointIndex]?.[1],
    )
  );
}

function sameGeometryFeatures(
  left: readonly KoreaMapGeometryFeature[],
  right: readonly KoreaMapGeometryFeature[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((feature, index) => {
    const candidate = right[index];
    if (
      candidate === undefined ||
      feature.accessibleName !== candidate.accessibleName ||
      feature.id !== candidate.id ||
      feature.geometry.kind !== candidate.geometry.kind ||
      !sameKeyboardAccessible(feature.keyboardAccessible, candidate.keyboardAccessible)
    ) {
      return false;
    }

    if (feature.geometry.kind === 'point' && candidate.geometry.kind === 'point') {
      return samePointsGeometry(feature.geometry, candidate.geometry);
    }

    if (feature.geometry.kind === 'line' && candidate.geometry.kind === 'line') {
      return sameLineGeometry(feature.geometry, candidate.geometry);
    }
    if (feature.geometry.kind === 'area' && candidate.geometry.kind === 'area') {
      return sameAreaGeometry(feature.geometry, candidate.geometry);
    }

    return false;
  });
}

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
  const previousItemsRef = useRef<readonly KoreaMapPoint[]>();
  onAcceptedRef.current = onAccepted;
  onRejectedRef.current = onRejected;
  onSelectRef.current = onSelect;
  const controlledItems = useMemo(
    () => (keyboardAccessible === undefined ? items : items.map((item) => ({ ...item, keyboardAccessible }))),
    [items, keyboardAccessible],
  );

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
    const shouldReplace =
      previousItemsRef.current === undefined ||
      !samePoints(previousItemsRef.current, controlledItems) ||
      retryVersion > 0;
    previousItemsRef.current = controlledItems;
    if (!shouldReplace) {
      return;
    }

    const result = layerRef.current?.replace(controlledItems);
    if (result?.status === 'rejected') {
      onRejectedRef.current?.(result.reason);
    } else if (result !== undefined) {
      onAcceptedRef.current?.();
    }
  }, [controlledItems, retryVersion, session]);

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
  const previousItemsRef = useRef<readonly KoreaMapGeometryFeature[]>();
  onAcceptedRef.current = onAccepted;
  onRejectedRef.current = onRejected;
  onSelectRef.current = onSelect;
  const controlledItems = useMemo(
    () => (keyboardAccessible === undefined ? items : items.map((item) => ({ ...item, keyboardAccessible }))),
    [items, keyboardAccessible],
  );

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
    const shouldReplace =
      previousItemsRef.current === undefined ||
      !sameGeometryFeatures(previousItemsRef.current, controlledItems) ||
      retryVersion > 0;
    previousItemsRef.current = controlledItems;
    if (!shouldReplace) {
      return;
    }

    const result = layerRef.current?.replace(controlledItems);
    if (result?.status === 'rejected') {
      onRejectedRef.current?.(result.reason);
    } else if (result !== undefined) {
      onAcceptedRef.current?.();
    }
  }, [controlledItems, retryVersion, session]);

  useEffect(() => {
    layerRef.current?.select(selectedId);
  }, [selectedId, session]);

  return null;
}
