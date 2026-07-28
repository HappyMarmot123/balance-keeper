import { render, screen } from '@testing-library/preact';
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

beforeEach(() => {
  queryClient.clear();
  vi.stubEnv('VITE_NAVER_MAPS_KEY_ID', '');
  vi.stubEnv('VITE_NAVER_MAP_STYLE_ID', '');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(weatherEnvelope), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    ),
  );
});

afterEach(() => {
  queryClient.clear();
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
