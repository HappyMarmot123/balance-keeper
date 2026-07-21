import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { PanelProps } from '../../../src/shared/ui';
import { Panel } from '../../../src/shared/ui';

describe('Panel', () => {
  it('announces a stable loading region', () => {
    render(<Panel status="loading" title="기상 관측" />);

    const panel = screen.getByRole('region', { name: '기상 관측' });

    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: '기상 관측' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('데이터를 불러오는 중입니다.');
  });

  it('shows successful content with upstream freshness', () => {
    render(
      <Panel freshness={{ dateTime: '2026-07-20T18:00:00+09:00', label: '18:00 기준' }} status="success" title="대기질">
        <p>서울 PM2.5 18㎍/㎥</p>
      </Panel>,
    );

    const panel = screen.getByRole('region', { name: '대기질' });
    const freshness = screen.getByText('18:00 기준');

    expect(panel.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByText('서울 PM2.5 18㎍/㎥')).toBeTruthy();
    expect(freshness.tagName).toBe('TIME');
    expect(freshness.getAttribute('datetime')).toBe('2026-07-20T18:00:00+09:00');
  });

  it('retains the last content while announcing stale upstream data', () => {
    render(
      <Panel
        freshness={{ dateTime: '2026-07-20T17:00:00+09:00', label: '17:00 기준' }}
        message="업스트림 연결이 지연되어 마지막 관측값을 표시합니다."
        status="stale"
        title="환율"
      >
        <p>USD/KRW 1,382.40</p>
      </Panel>,
    );

    expect(screen.getByText('USD/KRW 1,382.40')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('업스트림 연결이 지연');

    const freshness = screen.getByText('17:00 기준');
    expect(freshness.tagName).toBe('TIME');
    expect(freshness.getAttribute('datetime')).toBe('2026-07-20T17:00:00+09:00');
  });

  it('reports an actionable error with a reproducible code', () => {
    const onRetry = vi.fn();

    render(
      <Panel
        code="UPSTREAM_TIMEOUT"
        message="기상청 응답 시간이 초과되었습니다."
        onRetry={onRetry}
        status="error"
        title="기상 관측"
      />,
    );

    const alert = screen.getByRole('alert');
    const retry = screen.getByRole('button', { name: '다시 시도' });

    expect(alert.textContent).toContain('기상청 응답 시간이 초과되었습니다.');
    expect(alert.textContent).toContain('UPSTREAM_TIMEOUT');
    expect(retry.getAttribute('type')).toBe('button');

    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('explains an empty result and offers its supplied action', () => {
    const onSelect = vi.fn();

    render(
      <Panel
        action={{ label: '필터 초기화', onSelect }}
        message="선택한 조건에 해당하는 관측소가 없습니다."
        status="empty"
        title="관측소"
      />,
    );

    expect(screen.getByText('선택한 조건에 해당하는 관측소가 없습니다.')).toBeTruthy();

    const action = screen.getByRole('button', { name: '필터 초기화' });
    expect(action.getAttribute('type')).toBe('button');

    fireEvent.click(action);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('marks a disabled panel and keeps its reason visible', () => {
    render(<Panel message="고급 레이어가 비활성화되어 있습니다." status="disabled" title="군용기" />);

    const panel = screen.getByRole('region', { name: '군용기' });

    expect(panel.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('고급 레이어가 비활성화되어 있습니다.')).toBeTruthy();
  });

  it('announces a missing credential without rendering caller-provided details', () => {
    const unsafeProps = {
      message: 'NAVER_MAP_CLIENT_ID=client-secret',
      status: 'missing-credential',
      title: '실시간 지도',
    } as unknown as PanelProps;

    render(<Panel {...unsafeProps} />);

    expect(screen.getByRole('status').textContent).toContain('연결 설정이 필요합니다. 관리자에게 문의하세요.');
    expect(document.body.textContent).not.toContain('NAVER_MAP_CLIENT_ID');
    expect(document.body.textContent).not.toContain('client-secret');
  });

  it('keeps source and description metadata visible beside the datum rail', () => {
    render(
      <Panel
        description="대한민국 초단기 관측 자료"
        freshness={{ dateTime: '2026-07-20T18:00:00+09:00', label: '18:00 기준' }}
        source="KMA"
        status="success"
        title="기상 관측"
      >
        <p>맑음</p>
      </Panel>,
    );

    expect(screen.getByText('대한민국 초단기 관측 자료')).toBeTruthy();
    expect(screen.getByText('KMA')).toBeTruthy();
  });

  it('clears loading semantics when successful data replaces it', () => {
    const { rerender } = render(<Panel status="loading" title="지진" />);

    expect(screen.getByRole('region', { name: '지진' }).getAttribute('aria-busy')).toBe('true');

    rerender(
      <Panel freshness={{ dateTime: '2026-07-20T18:05:00+09:00', label: '18:05 기준' }} status="success" title="지진">
        <p>최근 감지된 지진이 없습니다.</p>
      </Panel>,
    );

    expect(screen.getByRole('region', { name: '지진' }).getAttribute('aria-busy')).toBeNull();
    expect(screen.queryByText('데이터를 불러오는 중입니다.')).toBeNull();
    expect(screen.getByText('최근 감지된 지진이 없습니다.')).toBeTruthy();
  });

  it('assigns distinct accessible labels to panels with duplicate titles', () => {
    render(
      <>
        <Panel status="loading" title="관측 현황" />
        <Panel status="loading" title="관측 현황" />
      </>,
    );

    const titleIds = screen
      .getAllByRole('region', { name: '관측 현황' })
      .map((panel) => panel.getAttribute('aria-labelledby'));

    expect(new Set(titleIds).size).toBe(2);
    expect(titleIds.every(Boolean)).toBe(true);
  });

  it('does not invent a retry action for a terminal error', () => {
    render(<Panel message="현재 제공할 수 없는 데이터입니다." status="error" title="시장 지수" />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
  });

  it('can render a static error specimen without an assertive announcement', () => {
    render(
      <Panel
        announce={false}
        code="SPECIMEN_ERROR"
        message="오류 상태의 정적 표본입니다."
        status="error"
        title="오류 표본"
      />,
    );

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('오류 상태의 정적 표본입니다.')).toBeTruthy();
  });

  it('supports a level-three title when nested inside a labelled dashboard section', () => {
    render(<Panel headingLevel={3} status="loading" title="중첩 패널" />);

    expect(screen.getByRole('heading', { level: 3, name: '중첩 패널' })).toBeTruthy();
  });

  it('provides wrapping boundaries for long provider metadata and error codes', () => {
    const longSource = `SOURCE_${'X'.repeat(80)}`;
    const longCode = `ERROR_${'Y'.repeat(80)}`;

    render(<Panel code={longCode} message="오류" source={longSource} status="error" title="긴 메타데이터" />);

    const panel = screen.getByRole('region', { name: '긴 메타데이터' });
    const source = screen
      .getAllByText((_content, element) => element?.textContent === `출처 ${longSource}`)
      .find((element) => element.tagName === 'SPAN');
    const code = screen.getByText(longCode);

    expect(panel.className.split(' ')).toContain('min-w-0');
    expect(source).toBeTruthy();
    expect(source?.className.split(' ')).toContain('break-all');
    expect(code.className.split(' ')).toContain('break-all');
  });
});
