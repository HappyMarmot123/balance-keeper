// @vitest-environment node

import { beforeAll, describe, expect, it } from 'vitest';

type LayerId =
  | 'cctv'
  | 'air-quality'
  | 'earthquakes'
  | 'road-incidents'
  | 'road-disasters'
  | 'vms'
  | 'safety-notices'
  | 'variable-speed-limits';

type FixtureViewport = Readonly<{
  maximumLatitude: number;
  maximumLongitude: number;
  minimumLatitude: number;
  minimumLongitude: number;
  zoom: number;
}>;

type RegistryModel = Readonly<{
  KOREA_MAP_GEOMETRY_VERTEX_BUDGET: number;
  KOREA_MAP_GLOBAL_OVERLAY_BUDGET: number;
  KOREA_MAP_LAYER_POINT_BUDGET: number;
  KOREA_MAP_LAYER_REGISTRY: readonly Readonly<{ id: LayerId; minimumZoom: number }>[];
  isMapCoordinateInViewport(
    coordinate: Readonly<{ latitude: number; longitude: number }>,
    viewport: FixtureViewport,
  ): boolean;
  isMapLayerZoomEligible(id: LayerId, zoom: number): boolean;
  resolveMapOverlayBudget(
    input: Readonly<{
      activeGeometryVertexCount: number;
      activeOverlayCount: number;
      geometryVertexCount: number;
      layerOverlayCount: number;
    }>,
  ):
    | Readonly<{ kind: 'render'; overlayCount: number }>
    | Readonly<{
        kind: 'suppressed';
        overlayCount: 0;
        reason: 'GEOMETRY_VERTEX_BUDGET_EXCEEDED' | 'GLOBAL_OVERLAY_BUDGET_EXCEEDED' | 'LAYER_OVERLAY_BUDGET_EXCEEDED';
      }>;
}>;

const viewport = {
  maximumLatitude: 38,
  maximumLongitude: 129,
  minimumLatitude: 34,
  minimumLongitude: 125,
  zoom: 10,
} as const;

let registryModel: RegistryModel | undefined;

beforeAll(async () => {
  const modulePath = '../../src/widgets/korea-map/model/mapLayerRegistry';
  try {
    registryModel = (await import(/* @vite-ignore */ modulePath)) as RegistryModel;
  } catch {
    registryModel = undefined;
  }
});

function getRegistryModel(): RegistryModel {
  expect(registryModel, 'T30 map layer registry model must exist before GREEN').toBeDefined();
  return registryModel as RegistryModel;
}

describe('Korea map layer registry', () => {
  it('keeps the eight approved location layers in deterministic product order', () => {
    const { KOREA_MAP_LAYER_REGISTRY } = getRegistryModel();
    const ids = KOREA_MAP_LAYER_REGISTRY.map((layer) => layer.id);

    expect(ids).toEqual([
      'cctv',
      'air-quality',
      'earthquakes',
      'road-incidents',
      'road-disasters',
      'vms',
      'safety-notices',
      'variable-speed-limits',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not register sources without trustworthy WGS84 coordinates or geometry', () => {
    const { KOREA_MAP_LAYER_REGISTRY } = getRegistryModel();
    const ids = new Set(KOREA_MAP_LAYER_REGISTRY.map((layer) => layer.id as string));

    expect(ids.has('weather-alerts')).toBe(false);
    expect(ids.has('disaster-messages')).toBe(false);
    expect(ids.has('maritime-grid')).toBe(false);
    expect(ids.has('road-traffic-forecast')).toBe(false);
  });

  it('includes coordinates exactly on every viewport boundary and excludes the smallest excess', () => {
    const { isMapCoordinateInViewport } = getRegistryModel();
    expect(isMapCoordinateInViewport({ latitude: 34, longitude: 125 }, viewport)).toBe(true);
    expect(isMapCoordinateInViewport({ latitude: 34, longitude: 129 }, viewport)).toBe(true);
    expect(isMapCoordinateInViewport({ latitude: 38, longitude: 125 }, viewport)).toBe(true);
    expect(isMapCoordinateInViewport({ latitude: 38, longitude: 129 }, viewport)).toBe(true);

    expect(isMapCoordinateInViewport({ latitude: 33.999_999, longitude: 127 }, viewport)).toBe(false);
    expect(isMapCoordinateInViewport({ latitude: 38.000_001, longitude: 127 }, viewport)).toBe(false);
    expect(isMapCoordinateInViewport({ latitude: 36, longitude: 124.999_999 }, viewport)).toBe(false);
    expect(isMapCoordinateInViewport({ latitude: 36, longitude: 129.000_001 }, viewport)).toBe(false);
  });

  it('admits every layer at its exact minimum zoom and rejects one level below it', () => {
    const { KOREA_MAP_LAYER_REGISTRY, isMapLayerZoomEligible } = getRegistryModel();
    for (const layer of KOREA_MAP_LAYER_REGISTRY) {
      expect(isMapLayerZoomEligible(layer.id, layer.minimumZoom)).toBe(true);
      expect(isMapLayerZoomEligible(layer.id, layer.minimumZoom - 1)).toBe(false);
    }
  });
});

describe('Korea map overlay budget', () => {
  it('publishes the approved layer, global, and geometry caps', () => {
    const { KOREA_MAP_GEOMETRY_VERTEX_BUDGET, KOREA_MAP_GLOBAL_OVERLAY_BUDGET, KOREA_MAP_LAYER_POINT_BUDGET } =
      getRegistryModel();
    expect(KOREA_MAP_LAYER_POINT_BUDGET).toBe(100);
    expect(KOREA_MAP_GLOBAL_OVERLAY_BUDGET).toBe(240);
    expect(KOREA_MAP_GEOMETRY_VERTEX_BUDGET).toBe(4_000);
  });

  it('accepts an exact layer budget and suppresses all 101 overlays instead of slicing them', () => {
    const { KOREA_MAP_LAYER_POINT_BUDGET, resolveMapOverlayBudget } = getRegistryModel();
    expect(
      resolveMapOverlayBudget({
        activeGeometryVertexCount: 0,
        activeOverlayCount: 0,
        geometryVertexCount: 0,
        layerOverlayCount: KOREA_MAP_LAYER_POINT_BUDGET,
      }),
    ).toEqual({ kind: 'render', overlayCount: 100 });

    expect(
      resolveMapOverlayBudget({
        activeGeometryVertexCount: 0,
        activeOverlayCount: 0,
        geometryVertexCount: 0,
        layerOverlayCount: KOREA_MAP_LAYER_POINT_BUDGET + 1,
      }),
    ).toEqual({ kind: 'suppressed', overlayCount: 0, reason: 'LAYER_OVERLAY_BUDGET_EXCEEDED' });
  });

  it('accepts exactly 240 global overlays and deterministically suppresses the whole layer at 241', () => {
    const { resolveMapOverlayBudget } = getRegistryModel();
    expect(
      resolveMapOverlayBudget({
        activeGeometryVertexCount: 0,
        activeOverlayCount: 140,
        geometryVertexCount: 0,
        layerOverlayCount: 100,
      }),
    ).toEqual({ kind: 'render', overlayCount: 100 });

    const overBudget = {
      activeGeometryVertexCount: 0,
      activeOverlayCount: 141,
      geometryVertexCount: 0,
      layerOverlayCount: 100,
    } as const;
    const expected = {
      kind: 'suppressed',
      overlayCount: 0,
      reason: 'GLOBAL_OVERLAY_BUDGET_EXCEEDED',
    } as const;

    expect(resolveMapOverlayBudget(overBudget)).toEqual(expected);
    expect(resolveMapOverlayBudget(overBudget)).toEqual(expected);
  });

  it('accepts the exact geometry vertex cap and suppresses the whole geometry above it', () => {
    const { KOREA_MAP_GEOMETRY_VERTEX_BUDGET, resolveMapOverlayBudget } = getRegistryModel();
    expect(
      resolveMapOverlayBudget({
        activeGeometryVertexCount: 0,
        activeOverlayCount: 0,
        geometryVertexCount: KOREA_MAP_GEOMETRY_VERTEX_BUDGET,
        layerOverlayCount: 1,
      }),
    ).toEqual({ kind: 'render', overlayCount: 1 });

    expect(
      resolveMapOverlayBudget({
        activeGeometryVertexCount: 0,
        activeOverlayCount: 0,
        geometryVertexCount: KOREA_MAP_GEOMETRY_VERTEX_BUDGET + 1,
        layerOverlayCount: 1,
      }),
    ).toEqual({ kind: 'suppressed', overlayCount: 0, reason: 'GEOMETRY_VERTEX_BUDGET_EXCEEDED' });
  });

  it('tracks geometry vertices across layers and suppresses the whole layer above the global cap', () => {
    const { resolveMapOverlayBudget } = getRegistryModel();

    expect(
      resolveMapOverlayBudget({
        activeGeometryVertexCount: 3_000,
        activeOverlayCount: 1,
        geometryVertexCount: 1_000,
        layerOverlayCount: 1,
      }),
    ).toEqual({ kind: 'render', overlayCount: 1 });

    expect(
      resolveMapOverlayBudget({
        activeGeometryVertexCount: 3_000,
        activeOverlayCount: 1,
        geometryVertexCount: 1_001,
        layerOverlayCount: 1,
      }),
    ).toEqual({ kind: 'suppressed', overlayCount: 0, reason: 'GEOMETRY_VERTEX_BUDGET_EXCEEDED' });
  });
});
