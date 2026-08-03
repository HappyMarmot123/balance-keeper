import {
  KOREA_MAP_SESSION_GEOMETRY_VERTEX_BUDGET,
  KOREA_MAP_SESSION_OVERLAY_BUDGET,
  type KoreaMapViewport,
} from '../../../entities/map';

export const KOREA_MAP_LAYER_POINT_BUDGET = 100;
export const KOREA_MAP_GLOBAL_OVERLAY_BUDGET = KOREA_MAP_SESSION_OVERLAY_BUDGET;
export const KOREA_MAP_GEOMETRY_VERTEX_BUDGET = KOREA_MAP_SESSION_GEOMETRY_VERTEX_BUDGET;

export type KoreaMapLayerId =
  | 'cctv'
  | 'air-quality'
  | 'earthquakes'
  | 'road-incidents'
  | 'road-disasters'
  | 'vms'
  | 'safety-notices'
  | 'variable-speed-limits';

export type KoreaMapLayerDefinition = Readonly<{
  id: KoreaMapLayerId;
  label: string;
  minimumZoom: number;
  renderer: 'geometry' | 'point';
  symbol: string;
}>;

export const KOREA_MAP_LAYER_REGISTRY = Object.freeze([
  { id: 'cctv', label: 'CCTV', minimumZoom: 9, renderer: 'point', symbol: 'C' },
  { id: 'air-quality', label: '대기질', minimumZoom: 7, renderer: 'point', symbol: 'A' },
  { id: 'earthquakes', label: '지진', minimumZoom: 7, renderer: 'point', symbol: 'E' },
  { id: 'road-incidents', label: '돌발상황', minimumZoom: 8, renderer: 'geometry', symbol: 'I' },
  { id: 'road-disasters', label: '도로 재난', minimumZoom: 8, renderer: 'geometry', symbol: 'D' },
  { id: 'vms', label: '도로전광표지', minimumZoom: 10, renderer: 'point', symbol: 'V' },
  { id: 'safety-notices', label: '주의운전', minimumZoom: 10, renderer: 'point', symbol: 'S' },
  { id: 'variable-speed-limits', label: '가변속도', minimumZoom: 10, renderer: 'point', symbol: 'L' },
] as const satisfies readonly KoreaMapLayerDefinition[]);

const layerById = new Map<KoreaMapLayerId, KoreaMapLayerDefinition>(
  KOREA_MAP_LAYER_REGISTRY.map((layer) => [layer.id, layer]),
);

export function isMapCoordinateInViewport(
  coordinate: Readonly<{ latitude: number; longitude: number }>,
  viewport: KoreaMapViewport,
): boolean {
  return (
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.latitude >= viewport.minimumLatitude &&
    coordinate.latitude <= viewport.maximumLatitude &&
    coordinate.longitude >= viewport.minimumLongitude &&
    coordinate.longitude <= viewport.maximumLongitude
  );
}

export function isMapLayerZoomEligible(id: KoreaMapLayerId, zoom: number): boolean {
  const layer = layerById.get(id);
  return layer !== undefined && Number.isFinite(zoom) && zoom >= layer.minimumZoom;
}

export type MapOverlayBudgetResult =
  | Readonly<{ kind: 'render'; overlayCount: number }>
  | Readonly<{
      kind: 'suppressed';
      overlayCount: 0;
      reason: 'GEOMETRY_VERTEX_BUDGET_EXCEEDED' | 'GLOBAL_OVERLAY_BUDGET_EXCEEDED' | 'LAYER_OVERLAY_BUDGET_EXCEEDED';
    }>;

export function resolveMapOverlayBudget(
  input: Readonly<{
    activeGeometryVertexCount: number;
    activeOverlayCount: number;
    geometryVertexCount: number;
    layerOverlayCount: number;
  }>,
): MapOverlayBudgetResult {
  if (
    !Number.isSafeInteger(input.layerOverlayCount) ||
    input.layerOverlayCount < 0 ||
    input.layerOverlayCount > KOREA_MAP_LAYER_POINT_BUDGET
  ) {
    return { kind: 'suppressed', overlayCount: 0, reason: 'LAYER_OVERLAY_BUDGET_EXCEEDED' };
  }

  if (
    !Number.isSafeInteger(input.activeGeometryVertexCount) ||
    input.activeGeometryVertexCount < 0 ||
    !Number.isSafeInteger(input.geometryVertexCount) ||
    input.geometryVertexCount < 0 ||
    input.activeGeometryVertexCount + input.geometryVertexCount > KOREA_MAP_GEOMETRY_VERTEX_BUDGET
  ) {
    return { kind: 'suppressed', overlayCount: 0, reason: 'GEOMETRY_VERTEX_BUDGET_EXCEEDED' };
  }

  if (
    !Number.isSafeInteger(input.activeOverlayCount) ||
    input.activeOverlayCount < 0 ||
    input.activeOverlayCount + input.layerOverlayCount > KOREA_MAP_GLOBAL_OVERLAY_BUDGET
  ) {
    return { kind: 'suppressed', overlayCount: 0, reason: 'GLOBAL_OVERLAY_BUDGET_EXCEEDED' };
  }

  return { kind: 'render', overlayCount: input.layerOverlayCount };
}
