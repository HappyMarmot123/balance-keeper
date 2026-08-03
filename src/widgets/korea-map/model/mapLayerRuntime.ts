import { isAppError } from '../../../shared/contracts';
import { countMapLayerItemGeometryVertices, type MapLayerItem } from './mapLayerItems';
import { KOREA_MAP_LAYER_REGISTRY, type KoreaMapLayerId, resolveMapOverlayBudget } from './mapLayerRegistry';

export type MapLayerPhase = 'empty' | 'error' | 'inactive' | 'loading' | 'missing-config' | 'ready' | 'zoom-required';

export type MapLayerRuntime = Readonly<{
  fetchedAt?: number;
  id: KoreaMapLayerId;
  items: readonly MapLayerItem[];
  label: string;
  partial: boolean;
  phase: MapLayerPhase;
  renderer: 'geometry' | 'point';
  retry: () => void;
  source?: string;
  stale: boolean;
}>;

export type ResolvedMapLayerRuntime = MapLayerRuntime &
  Readonly<{
    overlayItems: readonly MapLayerItem[];
    suppressionReason?:
      | 'GEOMETRY_VERTEX_BUDGET_EXCEEDED'
      | 'GLOBAL_OVERLAY_BUDGET_EXCEEDED'
      | 'LAYER_OVERLAY_BUDGET_EXCEEDED';
  }>;

export type MapLayerSelection = Readonly<{ itemId: string; layerId: KoreaMapLayerId }>;

const layerDefinitionById = new Map(KOREA_MAP_LAYER_REGISTRY.map((layer) => [layer.id, layer]));

const isMissingConfiguration = (error: unknown): boolean => isAppError(error) && error.code === 'MISSING_CREDENTIALS';

export function createMapLayerRuntime(
  input: Readonly<{
    active: boolean;
    eligible: boolean;
    error: unknown;
    fetchedAt?: number;
    hasData: boolean;
    id: KoreaMapLayerId;
    isPending: boolean;
    items: readonly MapLayerItem[];
    partial?: boolean;
    retry: () => void;
    source?: string;
    stale?: boolean;
  }>,
): MapLayerRuntime {
  let phase: MapLayerPhase;
  if (!input.active) {
    phase = 'inactive';
  } else if (!input.eligible) {
    phase = 'zoom-required';
  } else if (!input.hasData) {
    phase = input.isPending ? 'loading' : isMissingConfiguration(input.error) ? 'missing-config' : 'error';
  } else {
    phase = input.items.length === 0 ? 'empty' : 'ready';
  }

  const definition = layerDefinitionById.get(input.id);
  return {
    ...(input.fetchedAt === undefined ? {} : { fetchedAt: input.fetchedAt }),
    id: input.id,
    items: input.items,
    label: definition?.label ?? input.id,
    partial: input.partial ?? false,
    phase,
    renderer: definition?.renderer ?? 'point',
    retry: input.retry,
    ...(input.source === undefined ? {} : { source: input.source }),
    stale: (input.stale ?? false) || (input.hasData && input.error !== null),
  };
}

export function resolveMapLayerRuntimes(runtimes: readonly MapLayerRuntime[]): readonly ResolvedMapLayerRuntime[] {
  let activeGeometryVertexCount = 0;
  let activeOverlayCount = 0;

  return runtimes.map((runtime) => {
    if ((runtime.phase !== 'ready' && runtime.phase !== 'empty') || runtime.items.length === 0) {
      return { ...runtime, overlayItems: [] };
    }

    const geometryVertexCount = countMapLayerItemGeometryVertices(runtime.items);
    const budget = resolveMapOverlayBudget({
      activeGeometryVertexCount,
      activeOverlayCount,
      geometryVertexCount,
      layerOverlayCount: runtime.items.length,
    });
    if (budget.kind === 'suppressed') {
      return { ...runtime, overlayItems: [], suppressionReason: budget.reason };
    }

    activeGeometryVertexCount += geometryVertexCount;
    activeOverlayCount += budget.overlayCount;
    return { ...runtime, overlayItems: runtime.items };
  });
}

export function mapLayerRuntimeStatus(runtime: ResolvedMapLayerRuntime): string {
  if (runtime.suppressionReason !== undefined) {
    return runtime.suppressionReason === 'GLOBAL_OVERLAY_BUDGET_EXCEEDED'
      ? `${runtime.items.length}건입니다. 다른 레이어를 해제하거나 지도를 더 확대하세요.`
      : `${runtime.items.length}건으로 표시 예산을 초과했습니다. 지도를 더 확대하세요.`;
  }

  switch (runtime.phase) {
    case 'empty':
      return `현재 화면에 표시할 ${runtime.label} 정보가 없습니다.`;
    case 'error':
      return `${runtime.label} 정보를 불러오지 못했습니다.`;
    case 'inactive':
      return '';
    case 'loading':
      return `${runtime.label} 정보를 불러오는 중입니다.`;
    case 'missing-config':
      return `${runtime.label} 연결 설정이 필요합니다. 관리자에게 문의하세요.`;
    case 'ready':
      return `현재 화면 · ${runtime.items.length}건`;
    case 'zoom-required':
      return `지도를 확대하면 ${runtime.label} 정보를 표시합니다.`;
  }
}
