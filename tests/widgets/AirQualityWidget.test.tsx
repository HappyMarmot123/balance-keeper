import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AirQualitySnapshot } from '../../src/entities/air-quality';
import { AppError, type CacheStatus } from '../../src/shared/contracts';
import { AirQualityWidget } from '../../src/widgets/air-quality';
import { AirQualityView } from '../../src/widgets/air-quality/ui/AirQualityView';

const observedAt = Date.parse('2026-07-27T16:00:00+09:00');

const snapshotFixture: AirQualitySnapshot = {
  observedAt,
  observedStationCount: 2,
  region: 'seoul',
  stations: [
    {
      address: '서울 가상구 관측로 1',
      latitude: 37.57,
      longitude: 126.98,
      networkName: '도시대기',
      observedAt,
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
      observedAt,
      pm10: { concentration: 81, grade: 'bad' },
      pm25: { concentration: null, grade: null },
      providerRegionName: '서울',
      regionId: 'seoul',
      stationName: '한강가상',
    },
  ],
  totalStationCount: 2,
};

const envelopeFixture = (cache: CacheStatus = 'MISS') => ({
  data: snapshotFixture,
  meta: {
    cache,
    fetchedAt: Date.parse('2026-07-27T16:09:00+09:00'),
    requestId: 'air-quality-request-1',
    source: 'AirKorea',
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AirQualityView', () => {
  it('announces a stable loading panel for the selected region', () => {
    render(<AirQualityView data={undefined} error={null} isPending={true} onRetry={vi.fn()} region="seoul" />);

    const panel = screen.getByRole('region', { name: '서울 대기질' });

    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('데이터를 불러오는 중입니다.');
  });

  it('shows a safe actionable error and retries the query', () => {
    const onRetry = vi.fn();

    render(
      <AirQualityView
        data={undefined}
        error={new AppError('UPSTREAM_UNAVAILABLE')}
        isPending={false}
        onRetry={onRetry}
        region="seoul"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('대기질을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
    expect(alert.textContent).toContain('UPSTREAM_UNAVAILABLE');

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('explains a normalized empty response without inventing a concentration', () => {
    render(
      <AirQualityView
        data={{ ...envelopeFixture(), data: null }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByText('현재 제공할 수 있는 대기질 관측값이 없습니다.')).toBeTruthy();
    expect(screen.queryByText(/µg\/m³/)).toBeNull();
  });

  it('renders explicit units, text grades, station coverage and upstream KST freshness', () => {
    render(<AirQualityView data={envelopeFixture()} error={null} isPending={false} onRetry={vi.fn()} region="seoul" />);

    const panel = screen.getByRole('region', { name: '서울 대기질' });
    const assertions = [
      ['PM10 미세먼지', '81 µg/m³', '나쁨', '한강가상 측정소', '관측 범위 2/2 측정소'],
      ['PM2.5 초미세먼지', '15 µg/m³', '좋음', '북악가상 측정소', '관측 범위 1/2 측정소'],
    ] as const;

    for (const [label, value, grade, station, coverage] of assertions) {
      const term = within(panel).getByText(label);
      expect(term.tagName).toBe('DT');
      expect(term.parentElement?.textContent).toContain(value);
      expect(term.parentElement?.textContent).toContain(grade);
      expect(term.parentElement?.textContent).toContain(station);
      expect(term.parentElement?.textContent).toContain(coverage);
    }

    const freshness = screen.getByText('16:00 기준');
    expect(freshness.tagName).toBe('TIME');
    expect(freshness.getAttribute('datetime')).toBe('2026-07-27T07:00:00.000Z');
    expect(screen.getByText('AirKorea')).toBeTruthy();
    expect(screen.getByText('한국환경공단 에어코리아 · 미확정 실시간 관측')).toBeTruthy();
    expect(screen.queryByText('16:09 기준')).toBeNull();
  });

  it('makes partial regional coverage visible without hiding valid pollutant summaries', () => {
    render(<AirQualityView data={envelopeFixture()} error={null} isPending={false} onRetry={vi.fn()} region="seoul" />);

    expect(screen.getByText('일부 측정소의 관측값이 없어 관측 범위를 함께 표시합니다.')).toBeTruthy();
    expect(screen.getByText('81 µg/m³')).toBeTruthy();
    expect(screen.getByText('15 µg/m³')).toBeTruthy();
  });

  it('keeps gateway stale data visible with its upstream observation time', () => {
    render(
      <AirQualityView
        data={envelopeFixture('STALE')}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByText('81 µg/m³')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('게이트웨이가 마지막 성공 관측값을 제공하고 있습니다.');
    expect(screen.getByText('16:00 기준')).toBeTruthy();
  });

  it('keeps cached observations visible when a background refetch fails', () => {
    render(
      <AirQualityView
        data={envelopeFixture('HIT')}
        error={new AppError('NETWORK_ERROR')}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByText('81 µg/m³')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      '새 관측값을 가져오지 못해 마지막 성공 관측값을 표시합니다.',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('uses the terminal setup state for missing credentials without exposing configuration details', () => {
    const unsafeCause = new Error('KOREA_AIR_QUALITY_KEY=fixture-secret provider detail');

    render(
      <AirQualityView
        data={undefined}
        error={new AppError('MISSING_CREDENTIALS', { cause: unsafeCause })}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('연결 설정이 필요합니다. 관리자에게 문의하세요.');
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(document.body.textContent).not.toContain('KOREA_AIR_QUALITY_KEY');
    expect(document.body.textContent).not.toContain('fixture-secret');
    expect(document.body.textContent).not.toContain('provider detail');
  });
});

describe('AirQualityWidget', () => {
  it('loads the normalized Seoul snapshot through the public query integration', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(envelopeFixture()), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);

    render(
      <QueryClientProvider client={client}>
        <AirQualityWidget />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('81 µg/m³')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/air?region=seoul',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    client.clear();
  });
});
