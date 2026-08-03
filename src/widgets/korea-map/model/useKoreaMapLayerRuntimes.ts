import { useQueries, useQuery } from '@tanstack/preact-query';
import { useCallback, useMemo } from 'preact/hooks';

import { AIR_QUALITY_REGIONS, type AirQualityRegionId, airQualityQueryOptions } from '../../../entities/air-quality';
import { type CctvBounds, type CctvCamera, cctvListQueryOptions } from '../../../entities/cctv';
import { earthquakeQueryOptions } from '../../../entities/earthquake';
import type { KoreaMapViewport } from '../../../entities/map';
import { roadEventDisastersQueryOptions, roadEventIncidentsQueryOptions } from '../../../entities/road-event';
import {
  safetyNoticeQueryOptions,
  variableSpeedLimitQueryOptions,
  vmsGuidanceQueryOptions,
} from '../../../entities/road-guidance';
import type { SuccessMeta } from '../../../shared/contracts';
import { resolveCctvBounds } from './cctvViewport';
import {
  filterMapLayerItemsByViewport,
  type MapLayerItem,
  toAirQualityMapItem,
  toEarthquakeMapItem,
  toRoadEventMapItem,
  toSafetyNoticeMapItem,
  toVariableSpeedLimitMapItem,
  toVmsGuidanceMapItem,
} from './mapLayerItems';
import { isMapLayerZoomEligible, type KoreaMapLayerId } from './mapLayerRegistry';
import { createMapLayerRuntime, type ResolvedMapLayerRuntime, resolveMapLayerRuntimes } from './mapLayerRuntime';

const AIR_REGION_IDS = Object.freeze(Object.keys(AIR_QUALITY_REGIONS) as AirQualityRegionId[]);
const FALLBACK_CCTV_BOUNDS: CctvBounds = Object.freeze({
  maximumLatitude: 37.6,
  maximumLongitude: 127.1,
  minimumLatitude: 37.4,
  minimumLongitude: 126.9,
});

export type MapLayerCctvSnapshot = Readonly<{
  bounds: CctvBounds;
  cameras: readonly CctvCamera[];
}>;

type UseKoreaMapLayerRuntimesResult = Readonly<{
  cctvSnapshot?: MapLayerCctvSnapshot;
  runtimes: readonly ResolvedMapLayerRuntime[];
}>;

function toCctvMapItem(camera: CctvCamera): MapLayerItem {
  return {
    accessibleName: `${camera.name} 실시간 영상 보기`,
    detailLines: [camera.roadType === 'expressway' ? '고속도로' : '국도', '실시간 영상 제공'],
    geometry: { kind: 'point', position: [camera.longitude, camera.latitude] },
    id: camera.id,
    title: camera.name,
  };
}

function combineMeta(metas: readonly SuccessMeta[]): SuccessMeta | undefined {
  if (metas.length === 0) {
    return undefined;
  }

  return {
    cache: metas.some((meta) => meta.cache === 'STALE') ? 'STALE' : (metas[0]?.cache ?? 'MISS'),
    fetchedAt: Math.min(...metas.map((meta) => meta.fetchedAt)),
    requestId: metas.map((meta) => meta.requestId).join(','),
    source: [...new Set(metas.map((meta) => meta.source))].join(' + '),
  };
}

export function useKoreaMapLayerRuntimes(
  activeLayerIds: ReadonlySet<KoreaMapLayerId>,
  viewport: KoreaMapViewport | undefined,
): UseKoreaMapLayerRuntimesResult {
  const isEligible = useCallback(
    (id: KoreaMapLayerId) => viewport !== undefined && isMapLayerZoomEligible(id, viewport.zoom),
    [viewport],
  );
  const isEnabled = useCallback(
    (id: KoreaMapLayerId) => activeLayerIds.has(id) && isEligible(id),
    [activeLayerIds, isEligible],
  );
  const cctvBounds = viewport === undefined ? undefined : resolveCctvBounds(viewport);

  const cctvQuery = useQuery(
    cctvListQueryOptions(cctvBounds ?? FALLBACK_CCTV_BOUNDS, {
      enabled: isEnabled('cctv') && cctvBounds !== undefined,
    }),
  );
  const airQueries = useQueries({
    queries: AIR_REGION_IDS.map((region) => ({
      ...airQualityQueryOptions(region),
      enabled: isEnabled('air-quality'),
    })),
  });
  const earthquakeQuery = useQuery({ ...earthquakeQueryOptions(), enabled: isEnabled('earthquakes') });
  const incidentsQuery = useQuery(roadEventIncidentsQueryOptions({ enabled: isEnabled('road-incidents') }));
  const disastersQuery = useQuery(roadEventDisastersQueryOptions({ enabled: isEnabled('road-disasters') }));
  const vmsQuery = useQuery(vmsGuidanceQueryOptions({ enabled: isEnabled('vms') }));
  const safetyQuery = useQuery(safetyNoticeQueryOptions({ enabled: isEnabled('safety-notices') }));
  const speedLimitQuery = useQuery(variableSpeedLimitQueryOptions({ enabled: isEnabled('variable-speed-limits') }));

  const runtimes = useMemo(() => {
    const filter = (items: readonly MapLayerItem[]) =>
      viewport === undefined ? [] : filterMapLayerItemsByViewport(items, viewport);
    const airSuccesses = airQueries.flatMap((query) => (query.data === undefined ? [] : [query.data]));
    const airMeta = combineMeta(airSuccesses.map(({ meta }) => meta));
    const airErrors = airQueries.flatMap((query) => (query.error === null ? [] : [query.error]));
    const airItems = filter(airSuccesses.flatMap((envelope) => envelope.data?.stations.map(toAirQualityMapItem) ?? []));
    const cctvItems = filter(cctvQuery.data?.data.cameras.map(toCctvMapItem) ?? []);
    const earthquakeItems = filter(earthquakeQuery.data?.data.events.map(toEarthquakeMapItem) ?? []);
    const incidentItems = filter(incidentsQuery.data?.data.events.map(toRoadEventMapItem) ?? []);
    const disasterItems = filter(disastersQuery.data?.data.events.map(toRoadEventMapItem) ?? []);
    const vmsItems = filter(vmsQuery.data?.data.items.map(toVmsGuidanceMapItem) ?? []);
    const safetyItems = filter(safetyQuery.data?.data.items.map(toSafetyNoticeMapItem) ?? []);
    const speedLimitItems = filter(speedLimitQuery.data?.data.items.map(toVariableSpeedLimitMapItem) ?? []);

    return resolveMapLayerRuntimes([
      createMapLayerRuntime({
        active: activeLayerIds.has('cctv'),
        eligible: isEligible('cctv') && cctvBounds !== undefined,
        error: cctvQuery.error,
        fetchedAt: cctvQuery.data?.meta.fetchedAt,
        hasData: cctvQuery.data !== undefined,
        id: 'cctv',
        isPending: cctvQuery.isPending,
        items: cctvItems,
        retry: () => void cctvQuery.refetch(),
        source: cctvQuery.data?.meta.source,
        stale: cctvQuery.data?.meta.cache === 'STALE',
      }),
      createMapLayerRuntime({
        active: activeLayerIds.has('air-quality'),
        eligible: isEligible('air-quality'),
        error: airErrors[0] ?? null,
        fetchedAt: airMeta?.fetchedAt,
        hasData: airSuccesses.length > 0,
        id: 'air-quality',
        isPending: airQueries.some((query) => query.isPending),
        items: airItems,
        partial: airSuccesses.length > 0 && airSuccesses.length < AIR_REGION_IDS.length,
        retry: () => {
          for (const query of airQueries) {
            void query.refetch();
          }
        },
        source: airMeta?.source,
        stale: airMeta?.cache === 'STALE',
      }),
      createMapLayerRuntime({
        active: activeLayerIds.has('earthquakes'),
        eligible: isEligible('earthquakes'),
        error: earthquakeQuery.error,
        fetchedAt: earthquakeQuery.data?.meta.fetchedAt,
        hasData: earthquakeQuery.data !== undefined,
        id: 'earthquakes',
        isPending: earthquakeQuery.isPending,
        items: earthquakeItems,
        partial:
          earthquakeQuery.data !== undefined &&
          (earthquakeQuery.data.data.sources.kma.status !== 'available' ||
            earthquakeQuery.data.data.sources.usgs.status !== 'available'),
        retry: () => void earthquakeQuery.refetch(),
        source: earthquakeQuery.data?.meta.source,
        stale: earthquakeQuery.data?.meta.cache === 'STALE',
      }),
      createMapLayerRuntime({
        active: activeLayerIds.has('road-incidents'),
        eligible: isEligible('road-incidents'),
        error: incidentsQuery.error,
        fetchedAt: incidentsQuery.data?.meta.fetchedAt,
        hasData: incidentsQuery.data !== undefined,
        id: 'road-incidents',
        isPending: incidentsQuery.isPending,
        items: incidentItems,
        retry: () => void incidentsQuery.refetch(),
        source: incidentsQuery.data?.meta.source,
        stale: incidentsQuery.data?.meta.cache === 'STALE',
      }),
      createMapLayerRuntime({
        active: activeLayerIds.has('road-disasters'),
        eligible: isEligible('road-disasters'),
        error: disastersQuery.error,
        fetchedAt: disastersQuery.data?.meta.fetchedAt,
        hasData: disastersQuery.data !== undefined,
        id: 'road-disasters',
        isPending: disastersQuery.isPending,
        items: disasterItems,
        retry: () => void disastersQuery.refetch(),
        source: disastersQuery.data?.meta.source,
        stale: disastersQuery.data?.meta.cache === 'STALE',
      }),
      createMapLayerRuntime({
        active: activeLayerIds.has('vms'),
        eligible: isEligible('vms'),
        error: vmsQuery.error,
        fetchedAt: vmsQuery.data?.meta.fetchedAt,
        hasData: vmsQuery.data !== undefined,
        id: 'vms',
        isPending: vmsQuery.isPending,
        items: vmsItems,
        retry: () => void vmsQuery.refetch(),
        source: vmsQuery.data?.meta.source,
        stale: vmsQuery.data?.meta.cache === 'STALE',
      }),
      createMapLayerRuntime({
        active: activeLayerIds.has('safety-notices'),
        eligible: isEligible('safety-notices'),
        error: safetyQuery.error,
        fetchedAt: safetyQuery.data?.meta.fetchedAt,
        hasData: safetyQuery.data !== undefined,
        id: 'safety-notices',
        isPending: safetyQuery.isPending,
        items: safetyItems,
        retry: () => void safetyQuery.refetch(),
        source: safetyQuery.data?.meta.source,
        stale: safetyQuery.data?.meta.cache === 'STALE',
      }),
      createMapLayerRuntime({
        active: activeLayerIds.has('variable-speed-limits'),
        eligible: isEligible('variable-speed-limits'),
        error: speedLimitQuery.error,
        fetchedAt: speedLimitQuery.data?.meta.fetchedAt,
        hasData: speedLimitQuery.data !== undefined,
        id: 'variable-speed-limits',
        isPending: speedLimitQuery.isPending,
        items: speedLimitItems,
        retry: () => void speedLimitQuery.refetch(),
        source: speedLimitQuery.data?.meta.source,
        stale: speedLimitQuery.data?.meta.cache === 'STALE',
      }),
    ]);
  }, [
    activeLayerIds,
    airQueries,
    cctvBounds,
    cctvQuery,
    disastersQuery,
    earthquakeQuery,
    incidentsQuery,
    isEligible,
    safetyQuery,
    speedLimitQuery,
    viewport,
    vmsQuery,
  ]);

  return {
    ...(cctvQuery.data === undefined ? {} : { cctvSnapshot: cctvQuery.data.data }),
    runtimes,
  };
}
