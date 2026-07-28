import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import type { MacroSnapshot } from '../../src/entities/macro';
import { AppError, type CacheStatus } from '../../src/shared/contracts';
import * as macroViewModule from '../../src/widgets/macro/ui/MacroView';

const MacroView = (macroViewModule as Record<string, unknown>).MacroView as
  | ((props: {
      data:
        | {
            data: MacroSnapshot;
            meta: { cache: CacheStatus; fetchedAt: number; requestId: string; source: string };
          }
        | undefined;
      error: unknown | null;
      isPending: boolean;
      onRetry: () => void;
    }) => preact.JSX.Element)
  | undefined;

const snapshot: MacroSnapshot = {
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
};

const envelope = (cache: CacheStatus = 'MISS', data = snapshot, fetchedAt = Date.parse('2026-07-28T03:00:00Z')) => ({
  data,
  meta: {
    cache,
    fetchedAt,
    requestId: 'macro-view',
    source: 'ECOS',
  },
});

describe('MacroView', () => {
  it('renders loading and actionable error states', () => {
    expect(MacroView).toBeTypeOf('function');
    if (MacroView === undefined) {
      return;
    }

    const { rerender } = render(<MacroView data={undefined} error={null} isPending={true} onRetry={vi.fn()} />);
    expect(screen.getByRole('region', { name: '한국 거시경제' }).getAttribute('aria-busy')).toBe('true');

    const onRetry = vi.fn();
    rerender(
      <MacroView data={undefined} error={new AppError('UPSTREAM_UNAVAILABLE')} isPending={false} onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows values with separate observation periods and collection freshness', () => {
    expect(MacroView).toBeTypeOf('function');
    if (MacroView === undefined) {
      return;
    }

    render(<MacroView data={envelope()} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByText('1,382.4 원')).toBeTruthy();
    expect(screen.getByText('2.5 %')).toBeTruthy();
    expect(screen.getByText('4,183 억 달러')).toBeTruthy();
    expect(screen.getAllByText('2026.07.28 기준')).toHaveLength(2);
    expect(screen.getByText('2026.06 기준')).toBeTruthy();
    expect(screen.getByText('2026.07.28 12:00 수집')).toBeTruthy();
  });

  it('makes partial provider failure visible while retaining available values', () => {
    expect(MacroView).toBeTypeOf('function');
    if (MacroView === undefined) {
      return;
    }
    const partial: MacroSnapshot = {
      series: [
        snapshot.series[0],
        { ...snapshot.series[1], observation: null, status: 'unavailable' },
        snapshot.series[2],
      ],
    };

    render(<MacroView data={envelope('MISS', partial)} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('일부 ECOS 지표를 가져오지 못했습니다.');
    expect(screen.getByText('1,382.4 원')).toBeTruthy();
    expect(screen.getByText('일시적으로 확인 불가')).toBeTruthy();
  });

  it('distinguishes all-empty, missing credential and stale data', () => {
    expect(MacroView).toBeTypeOf('function');
    if (MacroView === undefined) {
      return;
    }
    const empty: MacroSnapshot = {
      series: snapshot.series.map((series) => ({
        ...series,
        observation: null,
        status: 'empty',
      })) as unknown as MacroSnapshot['series'],
    };

    const { rerender } = render(
      <MacroView data={envelope('MISS', empty)} error={null} isPending={false} onRetry={vi.fn()} />,
    );
    expect(screen.getByText('현재 조회 범위에 제공된 거시경제 자료가 없습니다.')).toBeTruthy();

    rerender(
      <MacroView data={undefined} error={new AppError('MISSING_CREDENTIALS')} isPending={false} onRetry={vi.fn()} />,
    );
    expect(screen.getByText('연결 설정이 필요합니다. 관리자에게 문의하세요.')).toBeTruthy();

    rerender(
      <MacroView
        data={envelope('STALE', snapshot, Date.parse('2026-07-21T03:00:00Z'))}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('마지막 성공 거시경제 정보를 제공');
    expect(screen.getByText('1,382.4 원')).toBeTruthy();
    expect(screen.getByText('2026.07.21 12:00 수집')).toBeTruthy();
  });
});
