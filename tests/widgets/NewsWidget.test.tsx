import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import type { NewsSnapshot } from '../../src/entities/news';
import { AppError, type CacheStatus } from '../../src/shared/contracts';
import * as newsViewModule from '../../src/widgets/news/ui/NewsView';

const NewsView = (newsViewModule as Record<string, unknown>).NewsView as
  | ((props: {
      data:
        | {
            data: NewsSnapshot;
            meta: { cache: CacheStatus; fetchedAt: number; requestId: string; source: string };
          }
        | undefined;
      error: unknown | null;
      isPending: boolean;
      onRetry: () => void;
    }) => preact.JSX.Element)
  | undefined;

const snapshot: NewsSnapshot = {
  items: [
    {
      id: 'mois:1012:120002',
      originalUrl:
        'https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=120002',
      publishedAt: Date.parse('2026-07-29T01:30:00.000Z'),
      sourceId: 'mois',
      title: '국민 안전 정책 발표',
    },
    {
      id: 'mcst:13001',
      originalUrl: 'https://www.mcst.go.kr/web/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=13001',
      publishedAt: Date.parse('2026-07-29T00:00:00.000Z'),
      sourceId: 'mcst',
      title: '문화 정책 발표',
    },
  ],
  sources: [
    {
      id: 'mcst',
      label: '문화체육관광부',
      license: 'KOGL-1',
      status: 'available',
    },
    {
      id: 'mois',
      label: '행정안전부',
      license: 'KOGL-1',
      status: 'available',
    },
  ],
};

const envelope = (cache: CacheStatus = 'MISS', data = snapshot, fetchedAt = Date.parse('2026-07-29T03:00:00Z')) => ({
  data,
  meta: {
    cache,
    fetchedAt,
    requestId: 'news-view',
    source: 'MCST+MOIS',
  },
});

describe('NewsView', () => {
  it('renders stable loading and actionable error states without a credential state', () => {
    expect(NewsView).toBeTypeOf('function');
    if (NewsView === undefined) {
      return;
    }

    const { rerender } = render(<NewsView data={undefined} error={null} isPending={true} onRetry={vi.fn()} />);
    expect(screen.getByRole('region', { name: '공공 정책 보도자료' }).getAttribute('aria-busy')).toBe('true');

    const onRetry = vi.fn();
    rerender(
      <NewsView data={undefined} error={new AppError('UPSTREAM_UNAVAILABLE')} isPending={false} onRetry={onRetry} />,
    );
    expect(document.body.textContent).not.toContain('연결 설정이 필요합니다');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows institution, publication time, secure original links, freshness and KOGL-1 attribution', () => {
    expect(NewsView).toBeTypeOf('function');
    if (NewsView === undefined) {
      return;
    }

    const { container } = render(<NewsView data={envelope()} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByText('행정안전부')).toBeTruthy();
    expect(screen.getByText('문화체육관광부')).toBeTruthy();
    expect(screen.getByText('07.29 10:30 KST')).toBeTruthy();
    expect(screen.getByText('07.29 09:00 KST')).toBeTruthy();
    expect(screen.getByText('2026.07.29 12:00 수집')).toBeTruthy();
    expect(screen.getByText(/공공누리 제1유형.*출처 표시/)).toBeTruthy();

    const originalLink = screen.getByRole('link', { name: /국민 안전 정책 발표.*새 창/ });
    expect(originalLink.getAttribute('href')).toBe(snapshot.items[0]?.originalUrl);
    expect(originalLink.getAttribute('href')).toMatch(/^https:\/\//);
    expect(originalLink.getAttribute('target')).toBe('_blank');
    expect(originalLink.getAttribute('rel')).toContain('noopener');
    expect(originalLink.getAttribute('rel')).toContain('noreferrer');
    expect(container.querySelector('img')).toBeNull();
  });

  it('makes a source-level partial failure visible while retaining valid headlines', () => {
    expect(NewsView).toBeTypeOf('function');
    if (NewsView === undefined) {
      return;
    }
    const partial: NewsSnapshot = {
      items: snapshot.items.filter((item) => item.sourceId === 'mcst'),
      sources: [
        snapshot.sources[0],
        {
          ...snapshot.sources[1],
          status: 'unavailable',
        },
      ],
    };

    render(<NewsView data={envelope('MISS', partial)} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('일부 기관 보도자료를 가져오지 못했습니다.');
    expect(screen.getByRole('link', { name: /문화 정책 발표/ })).toBeTruthy();
  });

  it('distinguishes an all-source empty result from stale retained data', () => {
    expect(NewsView).toBeTypeOf('function');
    if (NewsView === undefined) {
      return;
    }
    const empty: NewsSnapshot = {
      items: [],
      sources: snapshot.sources.map((source) => ({
        ...source,
        status: 'empty',
      })) as NewsSnapshot['sources'],
    };

    const { rerender } = render(
      <NewsView data={envelope('MISS', empty)} error={null} isPending={false} onRetry={vi.fn()} />,
    );
    expect(screen.getByText('현재 제공된 공공 보도자료가 없습니다.')).toBeTruthy();

    rerender(
      <NewsView
        data={envelope('STALE', snapshot, Date.parse('2026-07-29T02:00:00Z'))}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('마지막 성공 보도자료를 제공');
    expect(screen.getByRole('link', { name: /국민 안전 정책 발표/ })).toBeTruthy();
    expect(screen.getByText('2026.07.29 11:00 수집')).toBeTruthy();
  });

  it('retains successful data as stale when a background refresh fails', () => {
    expect(NewsView).toBeTypeOf('function');
    if (NewsView === undefined) {
      return;
    }

    render(
      <NewsView data={envelope()} error={new AppError('UPSTREAM_UNAVAILABLE')} isPending={false} onRetry={vi.fn()} />,
    );

    expect(screen.getByRole('status').textContent).toContain('새 보도자료를 가져오지 못해');
    expect(screen.getByRole('link', { name: /국민 안전 정책 발표/ })).toBeTruthy();
  });
});
