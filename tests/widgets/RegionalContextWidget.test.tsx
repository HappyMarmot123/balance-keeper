import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import type { EarthquakeSnapshot } from '../../src/entities/earthquake';
import type { MarketSnapshot } from '../../src/entities/market';
import type { NewsSnapshot } from '../../src/entities/news';
import type { WeatherNowcastData } from '../../src/entities/weather';
import { AppError, type CacheStatus, type SuccessMeta } from '../../src/shared/contracts';
import {
  RegionalContextView,
  type RegionalContextViewProps,
} from '../../src/widgets/regional-context/ui/RegionalContextView';

const snapshotTo = Date.parse('2026-07-29T03:00:00.000Z');
const earthquakeOccurredAt = Date.parse('2026-07-28T03:30:00.000Z');

const weatherSnapshot: NonNullable<WeatherNowcastData> = {
  observedAt: Date.parse('2026-07-29T03:00:00.000Z'),
  precipitationLastHourMm: 0,
  precipitationType: 'none',
  region: 'seoul',
  relativeHumidityPercent: 72,
  temperatureCelsius: 27.4,
  windDirectionDegrees: 250,
  windSpeedMetersPerSecond: 2.3,
};

const earthquakeSnapshot: EarthquakeSnapshot = {
  coverage: {
    maximumLatitude: 45,
    maximumLongitude: 145,
    minimumLatitude: 21,
    minimumLongitude: 110,
  },
  events: [
    {
      depthKm: 11,
      id: 'usgs:fixture-1',
      intensity: null,
      latitude: 37.12,
      location: '동아시아 가상 해역',
      longitude: 127.18,
      magnitude: 3.1,
      magnitudeType: 'mb',
      occurredAt: earthquakeOccurredAt,
      sourceRefs: [
        {
          aliases: ['fixture-1'],
          depthKm: 11,
          id: 'fixture-1',
          intensity: null,
          latitude: 37.12,
          location: '동아시아 가상 해역',
          longitude: 127.18,
          magnitude: 3.1,
          magnitudeType: 'mb',
          occurredAt: earthquakeOccurredAt,
          provider: 'USGS',
          updatedAt: earthquakeOccurredAt,
        },
      ],
      updatedAt: earthquakeOccurredAt,
    },
  ],
  sources: {
    kma: {
      from: snapshotTo - 3 * 24 * 60 * 60_000,
      status: 'available',
      to: snapshotTo,
    },
    usgs: {
      from: snapshotTo - 7 * 24 * 60 * 60_000,
      status: 'available',
      to: snapshotTo,
    },
  },
  window: {
    from: snapshotTo - 7 * 24 * 60 * 60_000,
    to: snapshotTo,
  },
};

const marketSnapshot: MarketSnapshot = {
  indices: [
    {
      displayUnit: 'pt',
      id: 'kospi',
      label: 'KOSPI',
      observation: { change: 18.42, changePercent: 0.66, close: 2811.72, date: '20260728' },
      providerName: '코스피',
      status: 'available',
    },
    {
      displayUnit: 'pt',
      id: 'kosdaq',
      label: 'KOSDAQ',
      observation: { change: -3.15, changePercent: -0.39, close: 807.41, date: '20260728' },
      providerName: '코스닥',
      status: 'available',
    },
  ],
};

const newsSnapshot: NewsSnapshot = {
  items: [
    {
      id: 'mois:fixture-1',
      originalUrl:
        'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=120002',
      publishedAt: Date.parse('2026-07-29T01:30:00.000Z'),
      sourceId: 'mois',
      title: '국민 안전 정책 발표',
    },
  ],
  sources: [
    { id: 'mcst', label: '문화체육관광부', license: 'KOGL-1', status: 'empty' },
    { id: 'mois', label: '행정안전부', license: 'KOGL-1', status: 'available' },
  ],
};

const createMeta = (source: string, fetchedAt: number, cache: CacheStatus = 'MISS'): SuccessMeta => ({
  cache,
  fetchedAt,
  requestId: `regional-${source}`,
  source,
});

const createSuccessProps = (): RegionalContextViewProps => ({
  earthquake: {
    data: { data: earthquakeSnapshot, meta: createMeta('KMA+USGS', Date.parse('2026-07-29T03:10:00.000Z')) },
    error: null,
    isPending: false,
    onRetry: vi.fn(),
  },
  markets: {
    data: {
      data: marketSnapshot,
      meta: createMeta('금융위원회 · 한국거래소 통계정보', Date.parse('2026-07-28T03:00:00.000Z')),
    },
    error: null,
    isPending: false,
    onRetry: vi.fn(),
  },
  news: {
    data: { data: newsSnapshot, meta: createMeta('MCST+MOIS', Date.parse('2026-07-29T03:00:00.000Z')) },
    error: null,
    isPending: false,
    onRetry: vi.fn(),
  },
  weather: {
    data: { data: weatherSnapshot, meta: createMeta('KMA', Date.parse('2026-07-29T03:09:00.000Z')) },
    error: null,
    isPending: false,
    onRetry: vi.fn(),
  },
});

const createUnavailableProps = (isPending: boolean, error: unknown | null): RegionalContextViewProps => ({
  earthquake: { data: undefined, error, isPending, onRetry: vi.fn() },
  markets: { data: undefined, error, isPending, onRetry: vi.fn() },
  news: { data: undefined, error, isPending, onRetry: vi.fn() },
  weather: { data: undefined, error, isPending, onRetry: vi.fn() },
});

describe('RegionalContextView', () => {
  it('renders one stable loading region while all source queries are pending', () => {
    render(<RegionalContextView {...createUnavailableProps(true, null)} />);

    const panel = screen.getByRole('region', { name: '한국 기준 동아시아 상황' });
    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('네 개 소스를 불러오는 중입니다.');
  });

  it('shows an actionable aggregate error and retries every source', () => {
    const props = createUnavailableProps(false, new AppError('UPSTREAM_UNAVAILABLE'));
    render(<RegionalContextView {...props} />);

    expect(screen.getByRole('alert').textContent).toContain('지역 상황 정보를 불러오지 못했습니다.');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(props.weather.onRetry).toHaveBeenCalledOnce();
    expect(props.earthquake.onRetry).toHaveBeenCalledOnce();
    expect(props.markets.onRetry).toHaveBeenCalledOnce();
    expect(props.news.onRetry).toHaveBeenCalledOnce();
  });

  it('presents four asymmetric source signals without claiming a country comparison', () => {
    render(<RegionalContextView {...createSuccessProps()} />);

    const panel = screen.getByRole('region', { name: '한국 기준 동아시아 상황' });
    const signals = within(panel).getByRole('list', { name: '지역 상황 신호' });

    expect(within(signals).getByText('KR-WX')).toBeTruthy();
    expect(within(signals).getByText('EA-EQ')).toBeTruthy();
    expect(within(signals).getByText('KR-MKT')).toBeTruthy();
    expect(within(signals).getByText('KR-PRESS')).toBeTruthy();
    expect(within(signals).getByText('27.4 °C · 습도 72 %')).toBeTruthy();
    expect(within(signals).getByText('최근 7일 1건 · 최대 M 3.1')).toBeTruthy();
    expect(within(signals).getByText('KOSPI 2,811.72 · KOSDAQ 807.41')).toBeTruthy();
    expect(within(signals).getByRole('link', { name: /국민 안전 정책 발표.*원문 새 창/ })).toBeTruthy();
    expect(screen.getByText('가장 오래된 수집 · 2026.07.28 12:00')).toBeTruthy();
    expect(
      screen.getByText(
        '동일 지표의 국가별 비교가 아니라, 한국 중심 데이터와 승인된 동아시아 지진 범위를 함께 보여줍니다.',
      ),
    ).toBeTruthy();
  });

  it('uses an empty panel only when every successful source has no displayable signal', () => {
    const current = createSuccessProps();
    if (
      current.weather.data === undefined ||
      current.earthquake.data === undefined ||
      current.markets.data === undefined ||
      current.news.data === undefined
    ) {
      throw new Error('success fixture must contain every source envelope');
    }
    const emptyProps: RegionalContextViewProps = {
      earthquake: {
        ...current.earthquake,
        data: {
          ...current.earthquake.data,
          data: { ...earthquakeSnapshot, events: [] },
        },
      },
      markets: {
        ...current.markets,
        data: {
          ...current.markets.data,
          data: {
            indices: marketSnapshot.indices.map((index) => ({
              ...index,
              observation: null,
              status: 'empty' as const,
            })) as MarketSnapshot['indices'],
          },
        },
      },
      news: {
        ...current.news,
        data: {
          ...current.news.data,
          data: {
            items: [],
            sources: newsSnapshot.sources.map((source) => ({
              ...source,
              status: 'empty' as const,
            })) as NewsSnapshot['sources'],
          },
        },
      },
      weather: {
        ...current.weather,
        data: { ...current.weather.data, data: null },
      },
    };

    render(<RegionalContextView {...emptyProps} />);

    expect(screen.getByText('현재 네 소스에 표시할 지역 상황 신호가 없습니다.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '지역 상황 신호' })).toBeNull();
  });

  it('retains the source rail when zero signals include a provider-partial result', () => {
    const current = createSuccessProps();
    if (
      current.weather.data === undefined ||
      current.earthquake.data === undefined ||
      current.markets.data === undefined ||
      current.news.data === undefined
    ) {
      throw new Error('success fixture must contain every source envelope');
    }
    const props: RegionalContextViewProps = {
      earthquake: {
        ...current.earthquake,
        data: {
          ...current.earthquake.data,
          data: {
            ...earthquakeSnapshot,
            events: [],
            sources: {
              ...earthquakeSnapshot.sources,
              usgs: { ...earthquakeSnapshot.sources.usgs, status: 'unavailable' },
            },
          },
        },
      },
      markets: {
        ...current.markets,
        data: {
          ...current.markets.data,
          data: {
            indices: marketSnapshot.indices.map((index) => ({
              ...index,
              observation: null,
              status: index.id === 'kospi' ? ('empty' as const) : ('unavailable' as const),
            })) as MarketSnapshot['indices'],
          },
        },
      },
      news: {
        ...current.news,
        data: {
          ...current.news.data,
          data: {
            items: [],
            sources: newsSnapshot.sources.map((source) => ({
              ...source,
              status: source.id === 'mcst' ? ('empty' as const) : ('unavailable' as const),
            })) as NewsSnapshot['sources'],
          },
        },
      },
      weather: {
        ...current.weather,
        data: { ...current.weather.data, data: null },
      },
    };

    render(<RegionalContextView {...props} />);

    expect(screen.getByRole('list', { name: '지역 상황 신호' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('PARTIAL');
    expect(screen.getByText('사용 가능한 소스에 표시할 통보 없음')).toBeTruthy();
    expect(screen.getByText('사용 가능한 지수에 최근 종가 없음')).toBeTruthy();
    expect(screen.getByText('사용 가능한 기관에 최신 보도자료 없음')).toBeTruthy();
    expect(screen.queryByText('최근 7일 통보 없음')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats one authoritative empty source beside current signals as a complete result', () => {
    const current = createSuccessProps();
    if (current.weather.data === undefined) {
      throw new Error('success fixture must contain a weather envelope');
    }
    const props: RegionalContextViewProps = {
      ...current,
      weather: {
        ...current.weather,
        data: { ...current.weather.data, data: null },
      },
    };

    render(<RegionalContextView {...props} />);

    expect(screen.getByText('관측값 없음')).toBeTruthy();
    expect(screen.getByText('KOSPI 2,811.72 · KOSDAQ 807.41')).toBeTruthy();
    expect(screen.queryByText('PARTIAL')).toBeNull();
    expect(screen.queryByText('STALE')).toBeNull();
  });

  it('uses a fresh PARTIAL state for a missing source without mislabelling it STALE', () => {
    const current = createSuccessProps();
    const props: RegionalContextViewProps = {
      ...current,
      news: {
        ...current.news,
        data: undefined,
        error: new AppError('MISSING_CREDENTIALS'),
      },
    };

    render(<RegionalContextView {...props} />);

    expect(screen.getByText('PARTIAL')).toBeTruthy();
    expect(screen.getByText('연결 설정 필요')).toBeTruthy();
    expect(screen.queryByText('STALE')).toBeNull();
    expect(screen.queryByRole('button', { name: '모든 소스 다시 불러오기' })).toBeNull();
  });

  it('describes unfinished source queries as loading instead of a connection failure', () => {
    const current = createSuccessProps();
    const pending = createUnavailableProps(true, null);
    const props: RegionalContextViewProps = {
      ...pending,
      weather: current.weather,
    };

    render(<RegionalContextView {...props} />);

    expect(screen.getByRole('status').textContent).toContain('LOADING');
    expect(screen.getByRole('status').textContent).toContain('나머지 소스를 불러오는 중입니다.');
    expect(screen.queryByText('PARTIAL')).toBeNull();
    expect(document.body.textContent).not.toContain('연결되지 않아');
  });

  it('preserves the setup guidance when every unavailable source is missing credentials', () => {
    const props = createUnavailableProps(false, new AppError('MISSING_CREDENTIALS'));

    render(<RegionalContextView {...props} />);

    expect(screen.getByText('연결 설정이 필요합니다. 관리자에게 문의하세요.')).toBeTruthy();
    expect(screen.queryByText('지역 상황 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.')).toBeNull();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
  });

  it('offers aggregate retry for a fresh internal provider failure', () => {
    const current = createSuccessProps();
    if (current.news.data === undefined) {
      throw new Error('success fixture must contain a news envelope');
    }
    const props: RegionalContextViewProps = {
      ...current,
      news: {
        ...current.news,
        data: {
          ...current.news.data,
          data: {
            ...newsSnapshot,
            sources: [{ ...newsSnapshot.sources[0], status: 'unavailable' }, newsSnapshot.sources[1]],
          },
        },
      },
    };

    render(<RegionalContextView {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '모든 소스 다시 불러오기' }));
    expect(props.weather.onRetry).toHaveBeenCalledOnce();
    expect(props.earthquake.onRetry).toHaveBeenCalledOnce();
    expect(props.markets.onRetry).toHaveBeenCalledOnce();
    expect(props.news.onRetry).toHaveBeenCalledOnce();
  });

  it('keeps a missing-credential cause visible beside retained data', () => {
    const current = createSuccessProps();
    const props: RegionalContextViewProps = {
      ...current,
      weather: {
        ...current.weather,
        error: new AppError('MISSING_CREDENTIALS'),
      },
    };

    render(<RegionalContextView {...props} />);

    expect(screen.getByRole('status').textContent).toContain('STALE');
    expect(screen.getByText('SETUP')).toBeTruthy();
    expect(screen.getByText('연결 설정 필요 · 마지막 성공 자료')).toBeTruthy();
    expect(screen.getByText('27.4 °C · 습도 72 %')).toBeTruthy();
  });

  it('retains available signals and discloses stale, partial and missing-credential sources', () => {
    const current = createSuccessProps();
    if (current.weather.data === undefined || current.earthquake.data === undefined) {
      throw new Error('success fixture must contain weather and earthquake envelopes');
    }
    const props: RegionalContextViewProps = {
      ...current,
      earthquake: {
        ...current.earthquake,
        data: {
          ...current.earthquake.data,
          data: {
            ...earthquakeSnapshot,
            sources: {
              ...earthquakeSnapshot.sources,
              kma: { ...earthquakeSnapshot.sources.kma, status: 'unavailable' },
            },
          },
        },
      },
      news: {
        ...current.news,
        data: undefined,
        error: new AppError('MISSING_CREDENTIALS'),
      },
      weather: {
        ...current.weather,
        data: {
          ...current.weather.data,
          meta: { ...current.weather.data.meta, cache: 'STALE' },
        },
      },
    };

    render(<RegionalContextView {...props} />);

    const statusText = screen
      .getAllByRole('status')
      .map((status) => status.textContent)
      .join(' ');
    expect(statusText).toContain('일부 소스가 지연되거나 연결되지 않아');
    expect(screen.getByText('27.4 °C · 습도 72 %')).toBeTruthy();
    expect(screen.getByText('연결 설정 필요')).toBeTruthy();
    expect(screen.getByText(/KMA 확인 불가/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '모든 소스 다시 불러오기' }));
    expect(props.weather.onRetry).toHaveBeenCalledOnce();
    expect(props.earthquake.onRetry).toHaveBeenCalledOnce();
    expect(props.markets.onRetry).toHaveBeenCalledOnce();
    expect(props.news.onRetry).toHaveBeenCalledOnce();
  });
});
