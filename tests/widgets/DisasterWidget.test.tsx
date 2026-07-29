import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import type { DisasterSnapshot } from '../../src/entities/disaster';
import { AppError } from '../../src/shared/contracts';
import { DisasterWidget } from '../../src/widgets/disaster';
import { DisasterView } from '../../src/widgets/disaster/ui/DisasterView';

const snapshot: DisasterSnapshot = {
  alerts: [
    {
      disasterType: '호우',
      emergencyStep: '긴급재난',
      id: '9003',
      issuedAt: Date.parse('2026-07-29T07:30:00.000Z'),
      message: '[행정안전부]  원문 공백을 그대로 표시합니다.',
      regionText: '서울특별시 전체, 경기도 일부',
    },
    {
      disasterType: '홍수',
      emergencyStep: '위급재난',
      id: '9002',
      issuedAt: Date.parse('2026-07-29T07:00:00.000Z'),
      message: '하천 범람 위험이 있으니 안전한 곳으로 대피하십시오.',
      regionText: '부산광역시',
    },
    {
      disasterType: '폭염',
      emergencyStep: '안전안내',
      id: '9001',
      issuedAt: Date.parse('2026-07-29T06:30:00.000Z'),
      message: '야외 활동 시 충분한 물을 준비하십시오.',
      regionText: '전국',
    },
  ],
};

const envelope = (cache: 'MISS' | 'HIT' | 'STALE' = 'MISS', data = snapshot) => ({
  data,
  meta: {
    cache,
    fetchedAt: Date.parse('2026-07-29T08:00:00.000Z'),
    requestId: 'disaster-view',
    source: '행정안전부+재난안전데이터공유플랫폼+공공누리 제4유형 기준',
  },
});

describe('DisasterView', () => {
  it('renders stable loading, missing-credential and actionable error states', () => {
    const sharedProps = {
      data: undefined,
      newAlertIds: [] as readonly string[],
      onRegionChange: vi.fn(),
      onRetry: vi.fn(),
      selectedRegion: '전체',
    };
    const { rerender } = render(<DisasterView {...sharedProps} error={null} isPending={true} />);

    expect(screen.getByRole('region', { name: '긴급재난문자' }).getAttribute('aria-busy')).toBe('true');

    rerender(<DisasterView {...sharedProps} error={new AppError('MISSING_CREDENTIALS')} isPending={false} />);
    expect(screen.getByText('연결 설정이 필요합니다. 관리자에게 문의하세요.')).toBeTruthy();

    const onRetry = vi.fn();
    rerender(
      <DisasterView
        {...sharedProps}
        error={new AppError('UPSTREAM_UNAVAILABLE')}
        isPending={false}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows official urgency labels, original text, region control, freshness and attribution', () => {
    const onRegionChange = vi.fn();
    const { container } = render(
      <DisasterView
        data={envelope()}
        error={null}
        isPending={false}
        newAlertIds={[]}
        onRegionChange={onRegionChange}
        onRetry={vi.fn()}
        selectedRegion="전체"
      />,
    );

    expect(screen.getByText('긴급재난')).toBeTruthy();
    expect(screen.getByText('위급재난')).toBeTruthy();
    expect(screen.getByText('안전안내')).toBeTruthy();
    expect(
      [...container.querySelectorAll('p.whitespace-pre-wrap')].some(
        (element) => element.textContent === snapshot.alerts[0]?.message,
      ),
    ).toBe(true);
    expect(screen.getByText('07.29 16:30 KST')).toBeTruthy();
    expect(screen.getByText('17:00 수집')).toBeTruthy();
    expect(screen.getByText(/공공누리 제4유형 기준.*비상업.*원문 변경 없음/)).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: '지역 필터' }), {
      target: { value: '서울특별시' },
    });
    expect(onRegionChange).toHaveBeenCalledWith('서울특별시');
  });

  it('announces newly arrived messages without rewriting their content', () => {
    render(
      <DisasterView
        data={envelope('HIT')}
        error={null}
        isPending={false}
        newAlertIds={['9003']}
        onRegionChange={vi.fn()}
        onRetry={vi.fn()}
        selectedRegion="전체"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('새 재난문자 1건이 도착했습니다.');
    expect(screen.getByRole('status').textContent).not.toContain(snapshot.alerts[0]?.message ?? '');
  });

  it('marks retained data stale and suppresses new-arrival language', () => {
    render(
      <DisasterView
        data={envelope('STALE')}
        error={null}
        isPending={false}
        newAlertIds={['9003']}
        onRegionChange={vi.fn()}
        onRetry={vi.fn()}
        selectedRegion="전체"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('마지막 성공 재난문자');
    expect(document.body.textContent).not.toContain('새 재난문자');
    expect(screen.getByText(snapshot.alerts[1]?.message ?? '')).toBeTruthy();
  });

  it('suppresses new-arrival language when a background refresh fails with retained data', () => {
    render(
      <DisasterView
        data={envelope('HIT')}
        error={new AppError('UPSTREAM_UNAVAILABLE')}
        isPending={false}
        newAlertIds={['9003']}
        onRegionChange={vi.fn()}
        onRetry={vi.fn()}
        selectedRegion="전체"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('마지막 성공 재난문자');
    expect(screen.queryByText(/건이 도착했습니다/u)).toBeNull();
    expect(screen.queryByText('NEW')).toBeNull();
  });

  it('shows nationwide alerts alongside the selected region and excludes other local alerts', () => {
    const { container } = render(
      <DisasterView
        data={envelope()}
        error={null}
        isPending={false}
        newAlertIds={[]}
        onRegionChange={vi.fn()}
        onRetry={vi.fn()}
        selectedRegion="서울특별시"
      />,
    );

    const visibleMessages = [...container.querySelectorAll('p.whitespace-pre-wrap')].map(
      (element) => element.textContent,
    );
    expect(visibleMessages).toEqual([snapshot.alerts[0]?.message, snapshot.alerts[2]?.message]);
  });

  it('distinguishes a current empty snapshot from retained stale data', () => {
    render(
      <DisasterView
        data={envelope('MISS', { alerts: [] })}
        error={null}
        isPending={false}
        newAlertIds={[]}
        onRegionChange={vi.fn()}
        onRetry={vi.fn()}
        selectedRegion="전체"
      />,
    );

    expect(screen.getByText('최근 2일 범위에 제공된 재난문자가 없습니다.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: '지역 필터' })).toBeNull();
  });
});

describe('DisasterWidget', () => {
  it('loads the normalized snapshot without announcing the initial payload as new', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fetcher = vi.fn(async () => Response.json(envelope()));
    vi.stubGlobal('fetch', fetcher);

    render(
      <QueryClientProvider client={client}>
        <DisasterWidget />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('하천 범람 위험이 있으니 안전한 곳으로 대피하십시오.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('새 재난문자');
    expect(fetcher).toHaveBeenCalledWith('/api/disaster', expect.objectContaining({ signal: expect.any(AbortSignal) }));

    client.clear();
  });
});
