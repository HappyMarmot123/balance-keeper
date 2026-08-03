// @vitest-environment node

import { beforeAll, describe, expect, it } from 'vitest';

import type { AirQualityStation } from '../../src/entities/air-quality';
import type { EarthquakeEvent } from '../../src/entities/earthquake';
import type { KoreaMapGeometry, KoreaMapViewport } from '../../src/entities/map';
import type { RoadEvent } from '../../src/entities/road-event';
import type { SafetyNoticeItem, VariableSpeedLimitItem, VmsGuidanceItem } from '../../src/entities/road-guidance';

type MapLayerItem = Readonly<{
  accessibleName: string;
  detailLines: readonly string[];
  geometry: KoreaMapGeometry;
  id: string;
  title: string;
}>;

type MapLayerItemsModel = Readonly<{
  countMapLayerGeometryVertices(geometry: KoreaMapGeometry): number;
  countMapLayerItemGeometryVertices(items: readonly MapLayerItem[]): number;
  filterMapLayerItemsByViewport(items: readonly MapLayerItem[], viewport: KoreaMapViewport): MapLayerItem[];
  toAirQualityMapItem(station: AirQualityStation): MapLayerItem;
  toEarthquakeMapItem(event: EarthquakeEvent): MapLayerItem;
  toRoadEventMapItem(event: RoadEvent): MapLayerItem;
  toSafetyNoticeMapItem(item: SafetyNoticeItem): MapLayerItem;
  toVariableSpeedLimitMapItem(item: VariableSpeedLimitItem): MapLayerItem;
  toVmsGuidanceMapItem(item: VmsGuidanceItem): MapLayerItem;
}>;

const observedAt = Date.UTC(2026, 7, 3, 0, 0, 0);

const station: AirQualityStation = {
  address: '서울 종로구 종로 1',
  latitude: 37.572,
  longitude: 126.979,
  networkName: '도시대기',
  observedAt,
  pm10: { concentration: 45, grade: 'moderate' },
  pm25: { concentration: null, grade: null },
  providerRegionName: '서울',
  regionId: 'seoul',
  stationName: '종로구',
};

const earthquake: EarthquakeEvent = {
  depthKm: 12,
  id: 'kma:202608030001',
  intensity: null,
  latitude: 37.4,
  location: '서울 동쪽 10km',
  longitude: 127.1,
  magnitude: 3.2,
  magnitudeType: 'ML',
  occurredAt: observedAt,
  sourceRefs: [
    {
      aliases: ['KMA:202608030001'],
      depthKm: 12,
      id: '202608030001',
      intensity: null,
      latitude: 37.4,
      location: '서울 동쪽 10km',
      longitude: 127.1,
      magnitude: 3.2,
      magnitudeType: 'ML',
      occurredAt: observedAt,
      provider: 'KMA',
      updatedAt: observedAt,
    },
  ],
  updatedAt: observedAt,
};

const roadEvent = (geometry: RoadEvent['geometry']): RoadEvent => ({
  category: 'traffic-accident',
  endsAt: null,
  geometry,
  id: `incident:${geometry.kind}`,
  lifecycle: 'unknown',
  message: '1차로 통제',
  severity: 'provider-unspecified',
  startsAt: observedAt,
});

const vms: VmsGuidanceItem = {
  id: 'its-road-guidance:vms:abcdefghijklmnopqrstuvwxyz012345',
  pages: [
    { lines: [], order: 1 },
    { lines: [], order: 2 },
  ],
  position: [127.2, 37.5],
  sourceTimestamp: '20260803120000',
  timeBasis: 'provider-local-unspecified',
};

const safetyNotice: SafetyNoticeItem = {
  id: 'its-road-guidance:safety-notice:abcdefghijklmnopqrstuvwxyz012345',
  message: '전방 안개 주의',
  position: [127.3, 37.6],
  providerPriorityCode: 2,
  providerStepCode: 1,
  providerType: 'fog',
};

const variableSpeedLimit: VariableSpeedLimitItem = {
  defaultLimitSpeed: 100,
  id: 'its-road-guidance:vsl:abcdefghijklmnopqrstuvwxyz012345',
  limitSpeed: 80,
  linkId: 'L-1',
  position: [127.4, 37.7],
  restrictionState: 'provider-unspecified',
  roadClass: 'national-road',
  roadNumber: '1',
  sourceCreatedTimestamp: '20260803110000',
  sourceRegisteredTimestamp: '20260803120000',
  speedUnit: 'provider-unspecified',
  timeBasis: 'provider-local-unspecified',
};

let model: MapLayerItemsModel | undefined;

beforeAll(async () => {
  const modulePath = '../../src/widgets/korea-map/model/mapLayerItems';
  try {
    model = (await import(/* @vite-ignore */ modulePath)) as MapLayerItemsModel;
  } catch {
    model = undefined;
  }
});

function getModel(): MapLayerItemsModel {
  expect(model, 'T30 map layer presentation adapters must exist before GREEN').toBeDefined();
  return model as MapLayerItemsModel;
}

describe('Korea map layer presentation adapters', () => {
  it('maps an air-quality station without changing its official position', () => {
    const item = getModel().toAirQualityMapItem(station);

    expect(item).toEqual({
      accessibleName: '대기질 종로구 측정소',
      detailLines: ['PM10 45', 'PM2.5 자료 없음', '서울 종로구 종로 1'],
      geometry: { kind: 'point', position: [126.979, 37.572] },
      id: 'air-quality:seoul:종로구',
      title: '종로구 측정소',
    });
  });

  it('maps an earthquake with nullable provider fields expressed neutrally', () => {
    const item = getModel().toEarthquakeMapItem(earthquake);

    expect(item).toEqual({
      accessibleName: '지진 규모 3.2, 서울 동쪽 10km',
      detailLines: ['규모 3.2', '깊이 12 km', '발생 2026-08-03T00:00:00.000Z', '출처 KMA'],
      geometry: { kind: 'point', position: [127.1, 37.4] },
      id: 'kma:202608030001',
      title: '서울 동쪽 10km',
    });
  });

  it('preserves official point, line, and area road-event geometry without centroid conversion', () => {
    const { toRoadEventMapItem } = getModel();
    const geometries = [
      { kind: 'point', position: [127, 37] },
      {
        kind: 'line',
        path: [
          [126, 36],
          [127, 37],
        ],
      },
      {
        kind: 'area',
        ring: [
          [126, 36],
          [127, 36],
          [127, 37],
        ],
      },
    ] as const satisfies readonly RoadEvent['geometry'][];

    const items = geometries.map((geometry) => toRoadEventMapItem(roadEvent(geometry)));

    expect(items.map((item) => item.geometry)).toEqual(geometries);
    expect(items.every((item) => item.title === '교통사고')).toBe(true);
    expect(items.flatMap((item) => item.detailLines).join(' ')).not.toMatch(/심각|위험도|중대도/u);
  });

  it('uses a neutral VMS fallback when every official page is blank', () => {
    expect(getModel().toVmsGuidanceMapItem(vms)).toEqual({
      accessibleName: '도로전광표지: 표시 문구 없음',
      detailLines: ['표시 문구 없음', '제공 시각 20260803120000 (시간대 미제공)'],
      geometry: { kind: 'point', position: [127.2, 37.5] },
      id: vms.id,
      title: '도로전광표지',
    });
  });

  it('keeps safety provider codes literal without inferring severity', () => {
    const item = getModel().toSafetyNoticeMapItem(safetyNotice);

    expect(item).toEqual({
      accessibleName: '주의운전 안내: 전방 안개 주의',
      detailLines: ['전방 안개 주의', '제공 유형 fog', '우선순위 코드 2', '단계 코드 1'],
      geometry: { kind: 'point', position: [127.3, 37.6] },
      id: safetyNotice.id,
      title: '주의운전 안내',
    });
    expect([item.accessibleName, item.title, ...item.detailLines].join(' ')).not.toMatch(/심각|위험도|중대도/u);
  });

  it('states that VSL speed units and application state are not provided', () => {
    const item = getModel().toVariableSpeedLimitMapItem(variableSpeedLimit);

    expect(item).toEqual({
      accessibleName: '가변형 속도제한 국도 1호, 제한 속도 80, 단위 미제공',
      detailLines: [
        '제한 속도 80 · 단위 미제공',
        '기본 제한 속도 100 · 단위 미제공',
        '적용 상태 미제공',
        '등록 시각 20260803120000 (시간대 미제공)',
      ],
      geometry: { kind: 'point', position: [127.4, 37.7] },
      id: variableSpeedLimit.id,
      title: '국도 1호',
    });
  });
});

describe('Korea map layer geometry policy', () => {
  it('includes viewport boundary points and intersecting geometry bounding boxes', () => {
    const { filterMapLayerItemsByViewport } = getModel();
    const viewport: KoreaMapViewport = {
      maximumLatitude: 38,
      maximumLongitude: 129,
      minimumLatitude: 34,
      minimumLongitude: 125,
      zoom: 10,
    };
    const item = (id: string, geometry: KoreaMapGeometry): MapLayerItem => ({
      accessibleName: id,
      detailLines: [],
      geometry,
      id,
      title: id,
    });
    const items = [
      item('minimum-boundary', { kind: 'point', position: [125, 34] }),
      item('maximum-boundary', { kind: 'point', position: [129, 38] }),
      item('crossing-line', {
        kind: 'line',
        path: [
          [124, 33],
          [130, 39],
        ],
      }),
      item('touching-area', {
        kind: 'area',
        ring: [
          [129, 35],
          [130, 35],
          [130, 36],
        ],
      }),
      item('outside-point', { kind: 'point', position: [129.000_001, 38] }),
      item('outside-line', {
        kind: 'line',
        path: [
          [130, 35],
          [131, 36],
        ],
      }),
    ];

    expect(filterMapLayerItemsByViewport(items, viewport).map(({ id }) => id)).toEqual([
      'minimum-boundary',
      'maximum-boundary',
      'crossing-line',
      'touching-area',
    ]);
  });

  it('counts point, line, and area vertices without converting geometry', () => {
    const { countMapLayerGeometryVertices, countMapLayerItemGeometryVertices } = getModel();
    const point: KoreaMapGeometry = { kind: 'point', position: [127, 37] };
    const line: KoreaMapGeometry = {
      kind: 'line',
      path: [
        [126, 36],
        [127, 37],
      ],
    };
    const area: KoreaMapGeometry = {
      kind: 'area',
      ring: [
        [126, 36],
        [127, 36],
        [127, 37],
      ],
    };
    const items = [point, line, area].map(
      (geometry, index): MapLayerItem => ({
        accessibleName: String(index),
        detailLines: [],
        geometry,
        id: String(index),
        title: String(index),
      }),
    );

    expect(countMapLayerGeometryVertices(point)).toBe(1);
    expect(countMapLayerGeometryVertices(line)).toBe(2);
    expect(countMapLayerGeometryVertices(area)).toBe(3);
    expect(countMapLayerItemGeometryVertices(items)).toBe(6);
  });
});
