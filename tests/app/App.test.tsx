import { render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/app/App';
import { queryClient } from '../../src/shared/api';

const weatherEnvelope = {
  data: {
    observedAt: Date.parse('2026-07-22T14:00:00+09:00'),
    precipitationLastHourMm: 0,
    precipitationType: 'none',
    region: 'seoul',
    relativeHumidityPercent: 72,
    temperatureCelsius: 27.4,
    windDirectionDegrees: 250,
    windSpeedMetersPerSecond: 2.3,
  },
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-07-22T14:09:00+09:00'),
    requestId: 'app-weather-request',
    source: 'KMA',
  },
} as const;

const weatherForecastFirstAt = Date.parse('2026-07-22T15:00:00+09:00');
const weatherForecastEnvelope = {
  data: {
    issuedAt: Date.parse('2026-07-22T14:00:00+09:00'),
    periods: Array.from({ length: 24 }, (_, index) => ({
      availability: 'available',
      forecastAt: weatherForecastFirstAt + index * 60 * 60_000,
      precipitationAmount: { kind: 'none' },
      precipitationProbabilityPercent: 10,
      precipitationType: 'none',
      relativeHumidityPercent: 65,
      skyCondition: 'clear',
      temperatureCelsius: 28 - index,
      windSpeedMetersPerSecond: 2.1,
    })),
    region: 'seoul',
  },
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-07-22T14:09:00+09:00'),
    requestId: 'app-weather-forecast-request',
    source: 'KMA',
  },
} as const;

const weatherAlertEnvelope = {
  data: {
    alerts: [
      {
        areaCode: 'L1010100',
        areaName: '서울특별시',
        command: 'change-issue',
        commandCode: 7,
        effectiveAt: Date.parse('2026-07-22T14:30:00+09:00'),
        endsAt: null,
        id: '202607221400-31-L1010100-12',
        issuedAt: Date.parse('2026-07-22T14:00:00+09:00'),
        kind: 'heat-wave',
        kindCode: 12,
        level: 'warning',
        levelCode: 1,
      },
    ],
    bulletin: {
      availability: 'available',
      details: '야외 활동과 온열질환에 유의하십시오.',
      issuedAt: Date.parse('2026-07-22T14:00:00+09:00'),
      title: '폭염경보 발표',
    },
    statusEffectiveAt: Date.parse('2026-07-22T14:30:00+09:00'),
    statusIssuedAt: Date.parse('2026-07-22T14:00:00+09:00'),
  },
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-07-22T14:09:00+09:00'),
    requestId: 'app-weather-alert-request',
    source: 'KMA',
  },
} as const;

const airQualityEnvelope = {
  data: {
    observedAt: Date.parse('2026-07-22T14:00:00+09:00'),
    observedStationCount: 2,
    region: 'seoul',
    stations: [
      {
        address: '서울 가상구 관측로 1',
        latitude: 37.57,
        longitude: 126.98,
        networkName: '도시대기',
        observedAt: Date.parse('2026-07-22T14:00:00+09:00'),
        pm10: { concentration: 31, grade: 'moderate' },
        pm25: { concentration: 15, grade: 'good' },
        providerRegionName: '서울',
        regionId: 'seoul',
        stationName: '북악가상',
      },
      {
        address: '서울 가상구 관측로 2',
        latitude: 37.51,
        longitude: 127.02,
        networkName: '도시대기',
        observedAt: Date.parse('2026-07-22T14:00:00+09:00'),
        pm10: { concentration: 81, grade: 'bad' },
        pm25: { concentration: null, grade: null },
        providerRegionName: '서울',
        regionId: 'seoul',
        stationName: '한강가상',
      },
    ],
    totalStationCount: 2,
  },
  meta: {
    cache: 'MISS',
    fetchedAt: Date.parse('2026-07-22T14:09:00+09:00'),
    requestId: 'app-air-quality-request',
    source: 'AirKorea',
  },
} as const;

const earthquakeSnapshotTo = Date.parse('2026-07-28T03:00:00.000Z');
const earthquakeOccurredAt = Date.parse('2026-07-27T03:30:05.120Z');
const earthquakeEnvelope = {
  data: {
    coverage: {
      maximumLatitude: 45,
      maximumLongitude: 145,
      minimumLatitude: 21,
      minimumLongitude: 110,
    },
    events: [
      {
        depthKm: 11,
        id: 'kma:108:42',
        intensity: '최대진도 III',
        latitude: 37.12,
        location: '충북 가상군 남남서쪽 9km 지역',
        longitude: 127.18,
        magnitude: 3.1,
        magnitudeType: null,
        occurredAt: earthquakeOccurredAt,
        sourceRefs: [
          {
            aliases: ['108:42:202607271245:2'],
            depthKm: 11,
            id: '108:42',
            intensity: '최대진도 III',
            latitude: 37.12,
            location: '충북 가상군 남남서쪽 9km 지역',
            longitude: 127.18,
            magnitude: 3.1,
            magnitudeType: null,
            occurredAt: earthquakeOccurredAt,
            provider: 'KMA',
            updatedAt: Date.parse('2026-07-27T03:45:00.000Z'),
          },
        ],
        updatedAt: Date.parse('2026-07-27T03:45:00.000Z'),
      },
    ],
    sources: {
      kma: {
        from: earthquakeSnapshotTo - 3 * 24 * 60 * 60_000,
        status: 'available',
        to: earthquakeSnapshotTo,
      },
      usgs: {
        from: earthquakeSnapshotTo - 7 * 24 * 60 * 60_000,
        status: 'available',
        to: earthquakeSnapshotTo,
      },
    },
    window: {
      from: earthquakeSnapshotTo - 7 * 24 * 60 * 60_000,
      to: earthquakeSnapshotTo,
    },
  },
  meta: {
    cache: 'MISS',
    fetchedAt: earthquakeSnapshotTo,
    requestId: 'app-earthquake-request',
    source: 'KMA+USGS',
  },
} as const;

const macroEnvelope = {
  data: {
    series: [
      {
        cycle: 'D',
        displayUnit: '원',
        id: 'usd-krw',
        itemCode: '0000001',
        label: '원/미국달러',
        observation: { period: '20260728', sourceValue: 1382.4, value: 1382.4 },
        sourceUnit: '원',
        statCode: '731Y001',
        status: 'available',
      },
      {
        cycle: 'D',
        displayUnit: '%',
        id: 'base-rate',
        itemCode: '0101000',
        label: '한국은행 기준금리',
        observation: { period: '20260728', sourceValue: 2.5, value: 2.5 },
        sourceUnit: '연%',
        statCode: '722Y001',
        status: 'available',
      },
      {
        cycle: 'M',
        displayUnit: '억 달러',
        id: 'fx-reserves',
        itemCode: '99',
        label: '외환보유액',
        observation: { period: '202606', sourceValue: 418_300_000, value: 4183 },
        sourceUnit: '천달러',
        statCode: '732Y001',
        status: 'available',
      },
    ],
  },
  meta: {
    cache: 'MISS',
    fetchedAt: earthquakeSnapshotTo,
    requestId: 'app-macro-request',
    source: 'ECOS',
  },
} as const;

const marketsEnvelope = {
  data: {
    indices: [
      {
        displayUnit: 'pt',
        id: 'kospi',
        label: 'KOSPI',
        observation: { change: 18.42, changePercent: 0.66, close: 2811.72, date: '20260727' },
        providerName: '코스피',
        status: 'available',
      },
      {
        displayUnit: 'pt',
        id: 'kosdaq',
        label: 'KOSDAQ',
        observation: { change: -3.15, changePercent: -0.39, close: 807.41, date: '20260727' },
        providerName: '코스닥',
        status: 'available',
      },
    ],
  },
  meta: {
    cache: 'MISS',
    fetchedAt: earthquakeSnapshotTo,
    requestId: 'app-markets-request',
    source: '금융위원회 · 한국거래소 통계정보',
  },
} as const;

beforeEach(() => {
  queryClient.clear();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-22T14:10:00+09:00'));
  vi.stubEnv('VITE_NAVER_MAPS_KEY_ID', '');
  vi.stubEnv('VITE_NAVER_MAP_STYLE_ID', '');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const envelope =
        requestUrl === '/api/weather/alerts'
          ? weatherAlertEnvelope
          : requestUrl === '/api/weather/forecast?region=seoul'
            ? weatherForecastEnvelope
            : requestUrl.startsWith('/api/air?')
              ? airQualityEnvelope
              : requestUrl === '/api/earthquake'
                ? earthquakeEnvelope
                : requestUrl === '/api/macro'
                  ? macroEnvelope
                  : requestUrl === '/api/markets'
                    ? marketsEnvelope
                    : weatherEnvelope;

      return Promise.resolve(
        new Response(JSON.stringify(envelope), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      );
    }),
  );
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('application bootstrap', () => {
  it('keeps an accessible page title without rendering the introduction panel', () => {
    render(<App />);

    const pageTitle = screen.getByRole('heading', { name: 'Korea Monitor', level: 1 });

    expect(pageTitle.classList.contains('sr-only')).toBe(true);
    expect(screen.queryByText('프로젝트 기반 설정이 완료되었습니다.')).toBeNull();
    expect(screen.queryByText('FOUNDATION / 04')).toBeNull();
    expect(screen.queryByText('RENDER')).toBeNull();
  });

  it('composes the Korea map as an independently labelled dashboard region', () => {
    render(<App />);

    expect(screen.getByRole('region', { name: '대한민국 상황 지도' })).toBeTruthy();
  });

  it('composes the theme control and live weather panel without foundation specimens', () => {
    render(<App />);

    expect(screen.getByRole('group', { name: '화면 테마' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '서울 기상 실황' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '서울 시간별 예보' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '서울 대기질' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '동아시아 지진' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '한국 거시경제' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '국내 주가지수' })).toBeTruthy();

    expect(screen.queryByText('STATE MATRIX')).toBeNull();
    expect(screen.queryByRole('region', { name: '시맨틱 토큰' })).toBeNull();
    expect(screen.queryByRole('region', { name: '신선도 보존' })).toBeNull();
    expect(screen.queryByRole('region', { name: '업스트림 오류' })).toBeNull();
  });

  it('renders the normalized KMA observation through the application query provider', async () => {
    render(<App />);

    expect(await screen.findByText('27.4 °C')).toBeTruthy();
    expect(screen.getByText('14:00 기준')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/weather?region=seoul',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders the nearest KMA forecast periods through the dedicated query', async () => {
    render(<App />);

    expect(await screen.findByText('28 °C')).toBeTruthy();
    expect(screen.getByText('14:00 발표')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/weather/forecast?region=seoul',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders active KMA weather alerts through the dedicated query', async () => {
    render(<App />);

    expect(await screen.findByText('서울특별시')).toBeTruthy();
    expect(screen.getByText('폭염')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/weather/alerts',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders the highest Seoul PM observations through the application query provider', async () => {
    render(<App />);

    expect(await screen.findByText('한강가상')).toBeTruthy();
    expect(screen.getByText('81 µg/m³')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/air?region=seoul',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders recent earthquake signals through the application query provider', async () => {
    render(<App />);

    expect(await screen.findByText('M 3.1')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: '동아시아 지진' })).getByText('충북 가상군 남남서쪽 9km 지역'),
    ).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/earthquake',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders the fixed ECOS macro snapshot through the application query provider', async () => {
    render(<App />);

    expect(await screen.findByText('1,382.4 원')).toBeTruthy();
    expect(screen.getByText('4,183 억 달러')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/macro',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders delayed domestic market closes through the application query provider', async () => {
    render(<App />);

    expect(await screen.findByText('2,811.72 pt')).toBeTruthy();
    expect(screen.getByText('상승 18.42 (+0.66%)')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/markets',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('lets the map canvas own the entire foundation row', () => {
    render(<App />);

    const mapRegion = screen.getByRole('region', { name: '대한민국 상황 지도' });
    const foundationRow = mapRegion.parentElement;

    expect(foundationRow?.classList.contains('lg:grid-cols-3')).toBe(false);
    expect(mapRegion.classList.contains('lg:col-span-2')).toBe(false);
  });

  it('doubles the map canvas minimum height at narrow and desktop widths', () => {
    render(<App />);

    const mapRegion = screen.getByRole('region', { name: '대한민국 상황 지도' });

    expect(mapRegion.classList.contains('min-h-160')).toBe(true);
    expect(mapRegion.classList.contains('lg:min-h-192')).toBe(true);
    expect(mapRegion.classList.contains('min-h-80')).toBe(false);
    expect(mapRegion.classList.contains('lg:min-h-96')).toBe(false);
  });

  it('keeps application chrome outside the main content landmark', () => {
    render(<App />);

    const banner = screen.getByRole('banner');
    const main = screen.getByRole('main');
    const contentInfo = screen.getByRole('contentinfo');

    expect(main.contains(banner)).toBe(false);
    expect(main.contains(contentInfo)).toBe(false);
  });
});
