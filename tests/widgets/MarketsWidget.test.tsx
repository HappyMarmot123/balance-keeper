import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import type { MarketSnapshot } from '../../src/entities/market';
import { AppError, type CacheStatus } from '../../src/shared/contracts';
import * as marketsViewModule from '../../src/widgets/markets/ui/MarketsView';

const MarketsView = (marketsViewModule as Record<string, unknown>).MarketsView as
  | ((props: {
      data:
        | {
            data: MarketSnapshot;
            meta: { cache: CacheStatus; fetchedAt: number; requestId: string; source: string };
          }
        | undefined;
      error: unknown | null;
      isPending: boolean;
      onRetry: () => void;
    }) => preact.JSX.Element)
  | undefined;

const snapshot: MarketSnapshot = {
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
};

const envelope = (cache: CacheStatus = 'MISS', data = snapshot, fetchedAt = Date.parse('2026-07-28T03:00:00Z')) => ({
  data,
  meta: {
    cache,
    fetchedAt,
    requestId: 'markets-view',
    source: '금융위원회 · 한국거래소 통계정보',
  },
});

describe('MarketsView', () => {
  it('renders loading and actionable error states', () => {
    expect(MarketsView).toBeTypeOf('function');
    if (MarketsView === undefined) {
      return;
    }

    const { rerender } = render(<MarketsView data={undefined} error={null} isPending={true} onRetry={vi.fn()} />);
    expect(screen.getByRole('region', { name: '국내 주가지수' }).getAttribute('aria-busy')).toBe('true');

    const onRetry = vi.fn();
    rerender(
      <MarketsView data={undefined} error={new AppError('UPSTREAM_UNAVAILABLE')} isPending={false} onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows delayed closes, direction text, provider dates and collection freshness separately', () => {
    expect(MarketsView).toBeTypeOf('function');
    if (MarketsView === undefined) {
      return;
    }

    render(<MarketsView data={envelope()} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByText('2,811.72 pt')).toBeTruthy();
    expect(screen.getByText('상승 18.42 (+0.66%)')).toBeTruthy();
    expect(screen.getByText('807.41 pt')).toBeTruthy();
    expect(screen.getByText('하락 3.15 (-0.39%)')).toBeTruthy();
    expect(screen.getAllByText('2026.07.27 최근 거래일')).toHaveLength(2);
    expect(screen.getByText('2026.07.28 12:00 수집')).toBeTruthy();
    expect(screen.getByText(/다음 영업일 13시 이후 · 하루 지연/)).toBeTruthy();
  });

  it('makes partial provider failure visible while retaining the available close', () => {
    expect(MarketsView).toBeTypeOf('function');
    if (MarketsView === undefined) {
      return;
    }
    const partial: MarketSnapshot = {
      indices: [snapshot.indices[0], { ...snapshot.indices[1], observation: null, status: 'unavailable' }],
    };

    render(<MarketsView data={envelope('MISS', partial)} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('일부 국내 지수를 가져오지 못했습니다.');
    expect(screen.getByText('2,811.72 pt')).toBeTruthy();
    expect(screen.getByText('일시적으로 확인 불가')).toBeTruthy();
  });

  it('distinguishes all-empty, missing credential and stale data', () => {
    expect(MarketsView).toBeTypeOf('function');
    if (MarketsView === undefined) {
      return;
    }
    const empty: MarketSnapshot = {
      indices: snapshot.indices.map((index) => ({
        ...index,
        observation: null,
        status: 'empty',
      })) as unknown as MarketSnapshot['indices'],
    };

    const { rerender } = render(
      <MarketsView data={envelope('MISS', empty)} error={null} isPending={false} onRetry={vi.fn()} />,
    );
    expect(screen.getByText('최근 조회 범위에 제공된 국내 지수 자료가 없습니다.')).toBeTruthy();

    rerender(
      <MarketsView data={undefined} error={new AppError('MISSING_CREDENTIALS')} isPending={false} onRetry={vi.fn()} />,
    );
    expect(screen.getByText('연결 설정이 필요합니다. 관리자에게 문의하세요.')).toBeTruthy();

    rerender(
      <MarketsView
        data={envelope('STALE', snapshot, Date.parse('2026-07-21T03:00:00Z'))}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('마지막 성공 국내 지수 정보를 제공');
    expect(screen.getByText('2,811.72 pt')).toBeTruthy();
    expect(screen.getByText('2026.07.21 12:00 수집')).toBeTruthy();
  });
});
