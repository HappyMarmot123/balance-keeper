import { render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/app/App';

beforeEach(() => {
  vi.stubEnv('VITE_NAVER_MAPS_KEY_ID', '');
  vi.stubEnv('VITE_NAVER_MAP_STYLE_ID', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it('composes the Atlas foundation controls and all panel lifecycle states', () => {
    render(<App />);

    expect(screen.getByRole('group', { name: '화면 테마' })).toBeTruthy();

    const panelTitles = [
      '시맨틱 토큰',
      '신선도 보존',
      '신호 수집',
      '업스트림 오류',
      '관측 결과',
      '제한 레이어',
      '지도 연결',
    ];

    for (const title of panelTitles) {
      expect(screen.getByRole('region', { name: title })).toBeTruthy();
    }

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('FOUNDATION_UPSTREAM')).toBeTruthy();
    expect(screen.getByText('연결 설정이 필요합니다. 관리자에게 문의하세요.')).toBeTruthy();
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
