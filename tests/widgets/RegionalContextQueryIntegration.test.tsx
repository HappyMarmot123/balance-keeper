import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { render, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { EarthquakeWidget } from '../../src/widgets/earthquake';
import { MarketsWidget } from '../../src/widgets/markets';
import { NewsWidget } from '../../src/widgets/news';
import { RegionalContextWidget } from '../../src/widgets/regional-context';
import { WeatherNowcastWidget } from '../../src/widgets/weather-nowcast';

const snapshotTo = Date.parse('2026-07-29T03:00:00.000Z');

const weatherEnvelope = {
  data: {
    observedAt: Date.parse('2026-07-29T02:50:00.000Z'),
    precipitationLastHourMm: 0,
    precipitationType: 'none',
    region: 'seoul',
    relativeHumidityPercent: 55,
    temperatureCelsius: 19.6,
    windDirectionDegrees: 180,
    windSpeedMetersPerSecond: 1.2,
  },
  meta: {
    cache: 'MISS',
    fetchedAt: snapshotTo,
    requestId: 'regional-query-weather',
    source: 'KMA',
  },
} as const;

const earthquakeEnvelope = {
  data: {
    coverage: {
      maximumLatitude: 45,
      maximumLongitude: 145,
      minimumLatitude: 21,
      minimumLongitude: 110,
    },
    events: [],
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
  },
  meta: {
    cache: 'MISS',
    fetchedAt: snapshotTo,
    requestId: 'regional-query-earthquake',
    source: 'KMA+USGS',
  },
} as const;

const marketsEnvelope = {
  data: {
    indices: [
      {
        displayUnit: 'pt',
        id: 'kospi',
        label: 'KOSPI',
        observation: { change: 9.2, changePercent: 0.32, close: 2888.88, date: '20260728' },
        providerName: '코스피',
        status: 'available',
      },
      {
        displayUnit: 'pt',
        id: 'kosdaq',
        label: 'KOSDAQ',
        observation: { change: -1.2, changePercent: -0.15, close: 799.99, date: '20260728' },
        providerName: '코스닥',
        status: 'available',
      },
    ],
  },
  meta: {
    cache: 'MISS',
    fetchedAt: snapshotTo,
    requestId: 'regional-query-markets',
    source: '금융위원회 · 한국거래소 통계정보',
  },
} as const;

const newsEnvelope = {
  data: {
    items: [
      {
        id: 'mois:regional-query',
        originalUrl:
          'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=120002',
        publishedAt: Date.parse('2026-07-29T01:30:00.000Z'),
        sourceId: 'mois',
        title: '지역 상황 통합 테스트 보도자료',
      },
    ],
    sources: [
      { id: 'mcst', label: '문화체육관광부', license: 'KOGL-1', status: 'empty' },
      { id: 'mois', label: '행정안전부', license: 'KOGL-1', status: 'available' },
    ],
  },
  meta: {
    cache: 'MISS',
    fetchedAt: snapshotTo,
    requestId: 'regional-query-news',
    source: 'MCST+MOIS',
  },
} as const;

const responseByPath = new Map<string, unknown>([
  ['/api/weather?region=seoul', weatherEnvelope],
  ['/api/earthquake', earthquakeEnvelope],
  ['/api/markets', marketsEnvelope],
  ['/api/news', newsEnvelope],
]);

const requestPath = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.pathname + input.search
      : new URL(input.url).pathname;

describe('RegionalContextWidget query integration', () => {
  it('shares the four existing query requests and never calls a neighbor endpoint', async () => {
    let releaseRequests: () => void = () => undefined;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      await requestGate;
      const payload = responseByPath.get(path);

      if (payload === undefined) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', requestId: 'unexpected-path' } }), {
          headers: { 'content-type': 'application/json' },
          status: 404,
        });
      }

      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnReconnect: false,
          refetchOnWindowFocus: false,
          retry: false,
        },
      },
    });

    vi.stubGlobal('fetch', fetchMock);
    const rendered = render(
      <QueryClientProvider client={client}>
        <WeatherNowcastWidget />
        <EarthquakeWidget />
        <MarketsWidget />
        <NewsWidget />
        <RegionalContextWidget />
      </QueryClientProvider>,
    );

    try {
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(4);
      });
      releaseRequests();

      const region = await within(document.body).findByRole('region', { name: '한국 기준 동아시아 상황' });
      expect(await within(region).findByText('19.6 °C · 습도 55 %')).toBeTruthy();
      expect(within(region).getByText('최근 7일 통보 없음')).toBeTruthy();
      expect(within(region).getByText('KOSPI 2,888.88 · KOSDAQ 799.99')).toBeTruthy();
      expect(within(region).getByRole('link', { name: /지역 상황 통합 테스트 보도자료.*원문 새 창/ })).toBeTruthy();

      const paths = fetchMock.mock.calls.map(([input]) => requestPath(input));
      expect(paths).toHaveLength(4);
      for (const path of responseByPath.keys()) {
        expect(paths.filter((candidate) => candidate === path)).toHaveLength(1);
      }
      expect(paths.some((path) => path.includes('/api/neighbor'))).toBe(false);
    } finally {
      releaseRequests();
      rendered.unmount();
      client.clear();
      vi.unstubAllGlobals();
    }
  });
});
