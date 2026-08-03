import type { AirQualityStation } from '../../../entities/air-quality';
import type { EarthquakeEvent } from '../../../entities/earthquake';
import type { KoreaMapGeometry, KoreaMapViewport } from '../../../entities/map';
import type { RoadEvent, RoadEventCategory, RoadEventPosition } from '../../../entities/road-event';
import type {
  RoadGuidancePosition,
  SafetyNoticeItem,
  VariableSpeedLimitItem,
  VmsGuidanceItem,
} from '../../../entities/road-guidance';
import { isMapCoordinateInViewport } from './mapLayerRegistry';

export type MapLayerItem = Readonly<{
  accessibleName: string;
  detailLines: readonly string[];
  geometry: KoreaMapGeometry;
  id: string;
  title: string;
}>;

const ROAD_EVENT_CATEGORY_LABELS = Object.freeze({
  disaster: '재난',
  flooding: '침수',
  other: '도로 돌발상황',
  'river-flood': '하천 홍수',
  roadwork: '도로 공사',
  sinkhole: '땅꺼짐',
  'traffic-accident': '교통사고',
  weather: '기상 영향',
  wildfire: '산불',
} satisfies Readonly<Record<RoadEventCategory, string>>);

const formatPollutant = (label: string, concentration: number | null): string =>
  concentration === null ? `${label} 자료 없음` : `${label} ${concentration}`;

export function toAirQualityMapItem(station: AirQualityStation): MapLayerItem {
  return {
    accessibleName: `대기질 ${station.stationName} 측정소`,
    detailLines: [
      formatPollutant('PM10', station.pm10.concentration),
      formatPollutant('PM2.5', station.pm25.concentration),
      station.address,
    ],
    geometry: { kind: 'point', position: [station.longitude, station.latitude] },
    id: `air-quality:${station.regionId}:${station.stationName}`,
    title: `${station.stationName} 측정소`,
  };
}

export function toEarthquakeMapItem(event: EarthquakeEvent): MapLayerItem {
  const magnitude = event.magnitude === null ? '규모 정보 없음' : `규모 ${event.magnitude}`;
  const location = event.location ?? '위치 정보 없음';
  const depth = event.depthKm === null ? '깊이 정보 없음' : `깊이 ${event.depthKm} km`;
  const providers = event.sourceRefs.map(({ provider }) => provider).join(', ');

  return {
    accessibleName: `지진 ${magnitude}, ${location}`,
    detailLines: [magnitude, depth, `발생 ${new Date(event.occurredAt).toISOString()}`, `출처 ${providers}`],
    geometry: { kind: 'point', position: [event.longitude, event.latitude] },
    id: event.id,
    title: location,
  };
}

export function toRoadEventMapItem(event: RoadEvent): MapLayerItem {
  const title = ROAD_EVENT_CATEGORY_LABELS[event.category];
  const message = event.message ?? '상세 내용 없음';
  const detailLines = [message, `시작 ${new Date(event.startsAt).toISOString()}`];
  if (event.endsAt !== null) {
    detailLines.push(`종료 ${new Date(event.endsAt).toISOString()}`);
  }

  return {
    accessibleName: `${title}: ${message}`,
    detailLines,
    geometry: event.geometry,
    id: event.id,
    title,
  };
}

const flattenVmsPages = (pages: VmsGuidanceItem['pages']): string[] =>
  pages.flatMap((page) => page.lines.map((line) => (pages.length === 1 ? line : `${page.order}페이지 · ${line}`)));

export function toVmsGuidanceMapItem(item: VmsGuidanceItem): MapLayerItem {
  const pageLines = flattenVmsPages(item.pages);
  const summary = pageLines[0] ?? '표시 문구 없음';
  const detailLines = pageLines.length === 0 ? [summary] : pageLines;

  return {
    accessibleName: `도로전광표지: ${summary}`,
    detailLines: [...detailLines, `제공 시각 ${item.sourceTimestamp} (시간대 미제공)`],
    geometry: toPointGeometry(item.position),
    id: item.id,
    title: '도로전광표지',
  };
}

export function toSafetyNoticeMapItem(item: SafetyNoticeItem): MapLayerItem {
  return {
    accessibleName: `주의운전 안내: ${item.message}`,
    detailLines: [
      item.message,
      `제공 유형 ${item.providerType}`,
      `우선순위 코드 ${item.providerPriorityCode}`,
      `단계 코드 ${item.providerStepCode}`,
    ],
    geometry: toPointGeometry(item.position),
    id: item.id,
    title: '주의운전 안내',
  };
}

const roadClassLabel = (roadClass: VariableSpeedLimitItem['roadClass']): string =>
  roadClass === 'expressway' ? '고속도로' : '국도';

export function toVariableSpeedLimitMapItem(item: VariableSpeedLimitItem): MapLayerItem {
  const roadName = `${roadClassLabel(item.roadClass)} ${item.roadNumber}호`;

  return {
    accessibleName: `가변형 속도제한 ${roadName}, 제한 속도 ${item.limitSpeed}, 단위 미제공`,
    detailLines: [
      `제한 속도 ${item.limitSpeed} · 단위 미제공`,
      `기본 제한 속도 ${item.defaultLimitSpeed} · 단위 미제공`,
      '적용 상태 미제공',
      `등록 시각 ${item.sourceRegisteredTimestamp} (시간대 미제공)`,
    ],
    geometry: toPointGeometry(item.position),
    id: item.id,
    title: roadName,
  };
}

function toPointGeometry(position: RoadGuidancePosition): KoreaMapGeometry {
  return { kind: 'point', position };
}

function geometryPositions(geometry: KoreaMapGeometry): readonly RoadEventPosition[] {
  switch (geometry.kind) {
    case 'area':
      return geometry.ring;
    case 'line':
      return geometry.path;
    case 'point':
      return [geometry.position];
  }
}

function geometryIntersectsViewport(geometry: KoreaMapGeometry, viewport: KoreaMapViewport): boolean {
  if (geometry.kind === 'point') {
    return isMapCoordinateInViewport({ latitude: geometry.position[1], longitude: geometry.position[0] }, viewport);
  }

  const positions = geometryPositions(geometry);
  if (positions.length === 0) {
    return false;
  }

  let minimumLongitude = Number.POSITIVE_INFINITY;
  let maximumLongitude = Number.NEGATIVE_INFINITY;
  let minimumLatitude = Number.POSITIVE_INFINITY;
  let maximumLatitude = Number.NEGATIVE_INFINITY;
  for (const [longitude, latitude] of positions) {
    minimumLongitude = Math.min(minimumLongitude, longitude);
    maximumLongitude = Math.max(maximumLongitude, longitude);
    minimumLatitude = Math.min(minimumLatitude, latitude);
    maximumLatitude = Math.max(maximumLatitude, latitude);
  }

  return (
    maximumLongitude >= viewport.minimumLongitude &&
    minimumLongitude <= viewport.maximumLongitude &&
    maximumLatitude >= viewport.minimumLatitude &&
    minimumLatitude <= viewport.maximumLatitude
  );
}

export function filterMapLayerItemsByViewport(
  items: readonly MapLayerItem[],
  viewport: KoreaMapViewport,
): MapLayerItem[] {
  const values = [
    viewport.maximumLatitude,
    viewport.maximumLongitude,
    viewport.minimumLatitude,
    viewport.minimumLongitude,
  ];
  if (
    !values.every(Number.isFinite) ||
    viewport.minimumLatitude > viewport.maximumLatitude ||
    viewport.minimumLongitude > viewport.maximumLongitude
  ) {
    return [];
  }

  return items.filter(({ geometry }) => geometryIntersectsViewport(geometry, viewport));
}

export function countMapLayerGeometryVertices(geometry: KoreaMapGeometry): number {
  return geometryPositions(geometry).length;
}

export function countMapLayerItemGeometryVertices(items: readonly MapLayerItem[]): number {
  return items.reduce((total, { geometry }) => total + countMapLayerGeometryVertices(geometry), 0);
}
