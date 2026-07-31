import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  WeatherAlert,
  WeatherAlertBulletin,
  WeatherAlertEnvelope,
  WeatherAlertSnapshot,
} from '../../src/entities/weather-alert';
import { AppError } from '../../src/shared/contracts';

type WeatherAlertViewProps = Readonly<{
  data: WeatherAlertEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
}>;

const issuedAt = Date.parse('2026-07-31T13:00:00+09:00');
const statusIssuedAt = Date.parse('2026-07-31T14:00:00+09:00');
const statusEffectiveAt = Date.parse('2026-07-31T14:30:00+09:00');

const alerts: WeatherAlert[] = [
  {
    areaCode: 'L101',
    areaName: '서울특별시',
    command: 'issue',
    commandCode: 1,
    effectiveAt: Date.parse('2026-07-31T14:30:00+09:00'),
    endsAt: Date.parse('2026-07-31T18:00:00+09:00'),
    id: '202607311400-1-L101-2',
    issuedAt,
    kind: 'heavy-rain',
    kindCode: 2,
    level: 'emergency-warning',
    levelCode: 2,
  },
  {
    areaCode: 'L102',
    areaName: '인천광역시',
    command: 'extend',
    commandCode: 3,
    effectiveAt: Date.parse('2026-07-31T14:20:00+09:00'),
    endsAt: null,
    id: '202607311400-2-L102-1',
    issuedAt,
    kind: 'strong-wind',
    kindCode: 1,
    level: 'warning',
    levelCode: 1,
  },
  {
    areaCode: 'L103',
    areaName: '부산광역시',
    command: 'change-issue',
    commandCode: 7,
    effectiveAt: Date.parse('2026-07-31T14:10:00+09:00'),
    endsAt: null,
    id: '202607311400-3-L103-7',
    issuedAt,
    kind: 'typhoon',
    kindCode: 7,
    level: 'warning',
    levelCode: 1,
  },
  {
    areaCode: 'L104',
    areaName: '대구광역시',
    command: 'issue',
    commandCode: 1,
    effectiveAt: Date.parse('2026-07-31T14:15:00+09:00'),
    endsAt: null,
    id: '202607311400-4-L104-12',
    issuedAt,
    kind: 'heat-wave',
    kindCode: 12,
    level: 'advisory',
    levelCode: 0,
  },
  {
    areaCode: 'L105',
    areaName: '제주도 앞바다와 남해서부 먼바다',
    command: 'correction',
    commandCode: 6,
    effectiveAt: Date.parse('2026-07-31T14:05:00+09:00'),
    endsAt: null,
    id: '202607311400-5-L105-6',
    issuedAt,
    kind: 'high-waves',
    kindCode: 6,
    level: 'advisory',
    levelCode: 0,
  },
  {
    areaCode: 'L106',
    areaName: '공식 코드 미확인 지역',
    command: 'issue',
    commandCode: 1,
    effectiveAt: Date.parse('2026-07-31T14:00:00+09:00'),
    endsAt: null,
    id: '202607311400-6-L106-99',
    issuedAt,
    kind: 'unknown',
    kindCode: 99,
    level: 'unknown',
    levelCode: 9,
  },
  {
    areaCode: 'L107',
    areaName: '목록에서 생략되는 일곱 번째 지역',
    command: 'issue',
    commandCode: 1,
    effectiveAt: Date.parse('2026-07-31T13:55:00+09:00'),
    endsAt: null,
    id: '202607311400-7-L107-98',
    issuedAt,
    kind: 'unknown',
    kindCode: 98,
    level: 'unknown',
    levelCode: 9,
  },
];

const availableBulletin: WeatherAlertBulletin = {
  availability: 'available',
  details: '현재 발효 중인 특보의 공식 통보문 보강 정보입니다.',
  issuedAt: statusIssuedAt,
  title: '기상특보 현황 통보',
};

const snapshot = (bulletin: WeatherAlertBulletin = availableBulletin): WeatherAlertSnapshot => ({
  alerts,
  bulletin,
  statusEffectiveAt,
  statusIssuedAt,
});

const envelope = (
  data: WeatherAlertSnapshot | null = snapshot(),
  cache: 'HIT' | 'MISS' | 'STALE' = 'MISS',
): WeatherAlertEnvelope => ({
  data,
  meta: {
    cache,
    fetchedAt: Date.parse('2026-07-31T14:35:00+09:00'),
    requestId: 'weather-alert-widget',
    source: 'KMA',
  },
});

const viewSourcePath = resolve(process.cwd(), 'src/widgets/weather-alert/ui/WeatherAlertView.tsx');
const publicSourcePath = resolve(process.cwd(), 'src/widgets/weather-alert/index.ts');

const loadWeatherAlertView = async (): Promise<ComponentType<WeatherAlertViewProps> | undefined> => {
  if (!existsSync(viewSourcePath)) {
    return undefined;
  }

  const module = await vi.importActual<Record<string, unknown>>('../../src/widgets/weather-alert/ui/WeatherAlertView');
  return module.WeatherAlertView as ComponentType<WeatherAlertViewProps> | undefined;
};

const loadWeatherAlertWidget = async (): Promise<ComponentType | undefined> => {
  if (!existsSync(publicSourcePath)) {
    return undefined;
  }

  const module = await vi.importActual<Record<string, unknown>>('../../src/widgets/weather-alert');
  return module.WeatherAlertWidget as ComponentType | undefined;
};

const requireView = async () => {
  const View = await loadWeatherAlertView();
  expect(View, 'WeatherAlertView must exist before its UI contract can pass').toBeTypeOf('function');
  return View;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WeatherAlertView', () => {
  it('announces loading and keeps missing credentials terminal', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    const sharedProps = { data: undefined, onRetry: vi.fn() };
    const { rerender } = render(<View {...sharedProps} error={null} isPending={true} />);

    expect(screen.getByRole('region', { name: '기상특보' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('데이터를 불러오는 중입니다.');

    rerender(
      <View
        {...sharedProps}
        error={
          new AppError('MISSING_CREDENTIALS', {
            cause: new Error('DATA_GO_KR_SERVICE_KEY=weather-alert-secret provider detail'),
          })
        }
        isPending={false}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('연결 설정이 필요합니다. 관리자에게 문의하세요.');
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(document.body.textContent).not.toContain('weather-alert-secret');
    expect(document.body.textContent).not.toContain('DATA_GO_KR_SERVICE_KEY');
  });

  it('shows a safe actionable error and retries', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    const onRetry = vi.fn();
    render(<View data={undefined} error={new AppError('UPSTREAM_UNAVAILABLE')} isPending={false} onRetry={onRetry} />);

    expect(screen.getByRole('alert').textContent).toContain('기상특보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
    expect(screen.getByRole('alert').textContent).toContain('UPSTREAM_UNAVAILABLE');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('distinguishes a fresh empty snapshot from an uncertain retained empty result', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    const { rerender } = render(<View data={envelope(null)} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByText('현재 발효 중인 기상특보가 없습니다.')).toBeTruthy();

    rerender(<View data={envelope(null, 'STALE')} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('마지막 성공 기상특보 현황');
    expect(screen.getByText('마지막 확인 시점에는 발효 중인 기상특보가 없었습니다.')).toBeTruthy();
    expect(screen.queryByText('현재 발효 중인 기상특보가 없습니다.')).toBeNull();
  });

  it('does not present a cached empty result as current after a background failure', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View data={envelope(null, 'HIT')} error={new AppError('NETWORK_ERROR')} isPending={false} onRetry={vi.fn()} />,
    );

    expect(screen.getByRole('status').textContent).toContain('새 현황을 가져오지 못해 마지막 확인 결과를 표시합니다.');
    expect(screen.getByText('마지막 확인 시점에는 발효 중인 기상특보가 없었습니다.')).toBeTruthy();
    expect(screen.queryByText('현재 발효 중인 기상특보가 없습니다.')).toBeNull();
  });

  it('keeps retained active alerts visible while marking them stale', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(<View data={envelope(snapshot(), 'STALE')} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('마지막 성공 기상특보 현황');
    expect(screen.getByRole('list', { name: '현재 발효 중인 기상특보' })).toBeTruthy();
    expect(screen.getByText('서울특별시')).toBeTruthy();
    expect(screen.getByText('14:35 확인')).toBeTruthy();
  });

  it('announces unavailable bulletin enrichment without hiding active status', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View
        data={envelope(snapshot({ availability: 'unavailable' }))}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain(
      '최근 통보문을 가져오지 못했습니다. 현재 발효 현황만 표시합니다.',
    );
    expect(screen.getByRole('list', { name: '현재 발효 중인 기상특보' })).toBeTruthy();
  });

  it('renders at most six ordered alerts with KST times, unknown codes and responsive semantics', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(<View data={envelope()} error={null} isPending={false} onRetry={vi.fn()} />);

    const panel = screen.getByRole('region', { name: '기상특보' });
    const list = within(panel).getByRole('list', { name: '현재 발효 중인 기상특보' });
    const items = within(list).getAllByRole('listitem');

    expect(items).toHaveLength(6);
    expect(list.classList.contains('grid-cols-1')).toBe(true);
    expect(list.classList.contains('lg:grid-cols-2')).toBe(true);
    expect(list.classList.contains('2xl:grid-cols-3')).toBe(true);
    expect(items.map((item) => within(item).getByRole('heading', { level: 3 }).textContent)).toEqual([
      '서울특별시',
      '인천광역시',
      '부산광역시',
      '대구광역시',
      '제주도 앞바다와 남해서부 먼바다',
      '공식 코드 미확인 지역',
    ]);
    expect(items[0]?.textContent).toContain('긴급경보');
    expect(items[0]?.textContent).toContain('호우');
    expect(items[5]?.textContent).toContain('종류 확인 불가 (99)');
    expect(items[5]?.textContent).toContain('수준 확인 불가 (9)');
    expect(screen.queryByText('목록에서 생략되는 일곱 번째 지역')).toBeNull();
    expect(screen.getByText('총 7건 중 우선순위 6건')).toBeTruthy();

    const issuedTime = within(items[0] as HTMLElement).getByText('07.31 13:00 KST');
    const effectiveTime = within(items[0] as HTMLElement).getByText('07.31 14:30 KST');
    const endingTime = within(items[0] as HTMLElement).getByText('07.31 18:00 KST');
    expect(issuedTime.tagName).toBe('TIME');
    expect(issuedTime.getAttribute('datetime')).toBe('2026-07-31T04:00:00.000Z');
    expect(effectiveTime.tagName).toBe('TIME');
    expect(effectiveTime.getAttribute('datetime')).toBe('2026-07-31T05:30:00.000Z');
    expect(endingTime.tagName).toBe('TIME');
    expect(endingTime.getAttribute('datetime')).toBe('2026-07-31T09:00:00.000Z');
    expect(screen.getByText('공공누리 제1유형 · 출처 표시')).toBeTruthy();
  });
});

describe('WeatherAlertWidget query integration', () => {
  it('loads only the dedicated alert endpoint and forwards query cancellation', async () => {
    const Widget = await loadWeatherAlertWidget();

    expect(Widget, 'weather-alert public API must export WeatherAlertWidget').toBeTypeOf('function');
    if (Widget === undefined) {
      return;
    }

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (path !== '/api/weather/alerts') {
        throw new Error(`unexpected endpoint: ${path}`);
      }
      return Response.json(envelope());
    });
    vi.stubGlobal('fetch', fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <Widget />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('region', { name: '기상특보' })).toBeTruthy();
    expect(await screen.findByText('서울특별시')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/weather/alerts',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetcher.mock.calls.some(([input]) => String(input).startsWith('/api/weather?'))).toBe(false);
    expect(fetcher.mock.calls.some(([input]) => input === '/api/disaster')).toBe(false);

    client.clear();
  });
});
