import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { AppError, type CacheStatus } from '../../src/shared/contracts';
import { WeatherNowcastView } from '../../src/widgets/weather-nowcast/ui/WeatherNowcastView';

const observedAt = Date.parse('2026-07-22T14:00:00+09:00');

const envelopeFixture = (cache: CacheStatus = 'MISS') =>
  ({
    data: {
      observedAt,
      precipitationLastHourMm: 0,
      precipitationType: 'none',
      region: 'seoul',
      relativeHumidityPercent: 72,
      temperatureCelsius: 27.4,
      windDirectionDegrees: 250,
      windSpeedMetersPerSecond: 2.3,
    },
    meta: {
      cache,
      fetchedAt: Date.parse('2026-07-22T14:09:00+09:00'),
      requestId: 'weather-request-1',
      source: 'KMA',
    },
  }) as const;

describe('WeatherNowcastView', () => {
  it('announces a stable loading panel for the selected region', () => {
    render(<WeatherNowcastView data={undefined} error={null} isPending={true} onRetry={vi.fn()} region="seoul" />);

    const panel = screen.getByRole('region', { name: '서울 기상 실황' });

    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('데이터를 불러오는 중입니다.');
  });

  it('shows a safe actionable error and retries the query', () => {
    const onRetry = vi.fn();

    render(
      <WeatherNowcastView
        data={undefined}
        error={new AppError('UPSTREAM_UNAVAILABLE')}
        isPending={false}
        onRetry={onRetry}
        region="seoul"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('기상 실황을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
    expect(alert.textContent).toContain('UPSTREAM_UNAVAILABLE');

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('explains a normalized empty response without inventing measurements', () => {
    render(
      <WeatherNowcastView
        data={{ ...envelopeFixture(), data: null }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByText('현재 제공할 수 있는 기상 관측값이 없습니다.')).toBeTruthy();
    expect(screen.queryByText(/°C/)).toBeNull();
  });

  it('does not present a cached empty result as current when its background refresh fails', () => {
    render(
      <WeatherNowcastView
        data={{ ...envelopeFixture(), data: null }}
        error={new AppError('NETWORK_ERROR')}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      '기상 실황을 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
    );
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
    expect(screen.queryByText('현재 제공할 수 있는 기상 관측값이 없습니다.')).toBeNull();
  });

  it('keeps gateway stale data visible with its upstream observation time', () => {
    render(
      <WeatherNowcastView
        data={envelopeFixture('STALE')}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByText('27.4 °C')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('게이트웨이가 마지막 성공 관측값을 제공하고 있습니다.');
    expect(screen.getByText('14:00 기준')).toBeTruthy();
  });

  it('keeps cached data stale when a background refetch fails', () => {
    render(
      <WeatherNowcastView
        data={envelopeFixture('HIT')}
        error={new AppError('NETWORK_ERROR')}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByText('27.4 °C')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      '새 관측값을 가져오지 못해 마지막 성공 관측값을 표시합니다.',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders successful measurements with explicit labels, units and KST freshness', () => {
    render(
      <WeatherNowcastView data={envelopeFixture()} error={null} isPending={false} onRetry={vi.fn()} region="seoul" />,
    );

    const panel = screen.getByRole('region', { name: '서울 기상 실황' });
    const assertions = [
      ['기온', '27.4 °C'],
      ['습도', '72 %'],
      ['1시간 강수', '0 mm'],
      ['강수 형태', '없음'],
      ['풍속', '2.3 m/s'],
      ['풍향', '250°'],
    ] as const;

    for (const [label, value] of assertions) {
      const term = within(panel).getByText(label);
      expect(term.tagName).toBe('DT');
      expect(term.parentElement?.textContent).toContain(value);
    }

    const freshness = screen.getByText('14:00 기준');
    expect(freshness.tagName).toBe('TIME');
    expect(freshness.getAttribute('datetime')).toBe('2026-07-22T05:00:00.000Z');
    expect(screen.getByText('KMA')).toBeTruthy();
    expect(screen.queryByText('14:09 기준')).toBeNull();
    expect(screen.queryByText('STALE')).toBeNull();
  });

  it('marks one missing measurement as unavailable without hiding valid neighbors', () => {
    const envelope = envelopeFixture();

    render(
      <WeatherNowcastView
        data={{
          ...envelope,
          data: { ...envelope.data, temperatureCelsius: null },
        }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    const temperature = screen.getByText('기온');
    expect(temperature.parentElement?.textContent).toContain('관측 없음');
    expect(screen.getByText('72 %')).toBeTruthy();
  });

  it('uses the terminal setup state for missing credentials without exposing configuration details', () => {
    const unsafeCause = new Error('KOREA_EARTHQUAKE_KEY=fixture-secret provider detail');

    render(
      <WeatherNowcastView
        data={undefined}
        error={new AppError('MISSING_CREDENTIALS', { cause: unsafeCause })}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('연결 설정이 필요합니다. 관리자에게 문의하세요.');
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(document.body.textContent).not.toContain('KOREA_EARTHQUAKE_KEY');
    expect(document.body.textContent).not.toContain('fixture-secret');
    expect(document.body.textContent).not.toContain('provider detail');
  });
});
