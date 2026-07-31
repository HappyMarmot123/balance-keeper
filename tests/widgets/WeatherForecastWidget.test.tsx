import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/shared/contracts';

type WeatherForecastViewProps = Readonly<{
  data: unknown;
  error: unknown | null;
  isPending: boolean;
  now?: number;
  onRetry: () => void;
  region: 'seoul' | 'busan';
}>;

const firstForecastAt = Date.parse('2026-07-31T23:00:00+09:00');
const viewNow = firstForecastAt - 1;

const createForecast = (unavailableIndex?: number) => ({
  issuedAt: Date.parse('2026-07-31T20:00:00+09:00'),
  periods: Array.from({ length: 24 }, (_, index) =>
    index === unavailableIndex
      ? {
          availability: 'unavailable',
          forecastAt: firstForecastAt + index * 60 * 60_000,
        }
      : {
          availability: 'available',
          forecastAt: firstForecastAt + index * 60 * 60_000,
          precipitationAmount: { kind: 'none' },
          precipitationProbabilityPercent: 10 + index,
          precipitationType: 'none',
          relativeHumidityPercent: 60 + index,
          skyCondition: 'clear',
          temperatureCelsius: 28 - index,
          windSpeedMetersPerSecond: 2 + index / 10,
        },
  ),
  region: 'seoul',
});

const createEnvelope = (cache: 'HIT' | 'MISS' | 'STALE' = 'MISS', unavailableIndex?: number) => ({
  data: createForecast(unavailableIndex),
  meta: {
    cache,
    fetchedAt: Date.parse('2026-07-31T20:05:00+09:00'),
    requestId: 'weather-forecast-widget',
    source: 'KMA',
  },
});

const viewSourcePath = resolve(process.cwd(), 'src/widgets/weather-forecast/ui/WeatherForecastView.tsx');
const publicSourcePath = resolve(process.cwd(), 'src/widgets/weather-forecast/index.ts');

const loadWeatherForecastView = async (): Promise<ComponentType<WeatherForecastViewProps> | undefined> => {
  if (!existsSync(viewSourcePath)) {
    return undefined;
  }

  const module = await vi.importActual<Record<string, unknown>>(
    '../../src/widgets/weather-forecast/ui/WeatherForecastView',
  );

  return module.WeatherForecastView as ComponentType<WeatherForecastViewProps> | undefined;
};

const loadWeatherForecastWidget = async (): Promise<ComponentType | undefined> => {
  if (!existsSync(publicSourcePath)) {
    return undefined;
  }

  const module = await vi.importActual<Record<string, unknown>>('../../src/widgets/weather-forecast');

  return module.WeatherForecastWidget as ComponentType | undefined;
};

const requireView = async () => {
  const View = await loadWeatherForecastView();

  expect(View, 'WeatherForecastView must exist before its UI contract can pass').toBeTypeOf('function');
  return View;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WeatherForecastView', () => {
  it('announces a stable loading panel for Seoul', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(<View data={undefined} error={null} isPending={true} onRetry={vi.fn()} region="seoul" />);

    const panel = screen.getByRole('region', { name: '서울 시간별 예보' });
    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('데이터를 불러오는 중입니다.');
  });

  it('shows an actionable safe error and retries', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    const onRetry = vi.fn();
    render(
      <View
        data={undefined}
        error={new AppError('UPSTREAM_UNAVAILABLE')}
        isPending={false}
        onRetry={onRetry}
        region="seoul"
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      '시간별 예보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
    );
    expect(screen.getByRole('alert').textContent).toContain('UPSTREAM_UNAVAILABLE');

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders an explicit empty state without inventing forecast periods', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View
        data={{ ...createEnvelope(), data: null }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByText('현재 제공할 시간별 예보가 없습니다.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '서울 시간별 예보' })).toBeNull();
  });

  it('uses the terminal setup state without exposing credential details', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View
        data={undefined}
        error={
          new AppError('MISSING_CREDENTIALS', {
            cause: new Error('DATA_GO_KR_SERVICE_KEY=forecast-secret provider detail'),
          })
        }
        isPending={false}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('연결 설정이 필요합니다. 관리자에게 문의하세요.');
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(document.body.textContent).not.toContain('forecast-secret');
    expect(document.body.textContent).not.toContain('DATA_GO_KR_SERVICE_KEY');
  });

  it('keeps a stale forecast visible with the provider issue time', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View
        data={createEnvelope('STALE')}
        error={null}
        isPending={false}
        now={viewNow}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('게이트웨이가 마지막 성공 예보를 제공하고 있습니다.');
    expect(screen.getByText('20:00 발표')).toBeTruthy();
    expect(screen.getByRole('list', { name: '서울 시간별 예보' })).toBeTruthy();
  });

  it('preserves a missing hour in place and announces a partial forecast', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View
        data={createEnvelope('MISS', 2)}
        error={null}
        isPending={false}
        now={viewNow}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    const list = screen.getByRole('list', { name: '서울 시간별 예보' });
    const items = within(list).getAllByRole('listitem');

    expect(items).toHaveLength(6);
    expect(screen.getByRole('status').textContent).toContain('일부 시간대 자료 없음');
    expect(items[2]?.textContent).toContain('예보 없음');
    expect(items[1]?.textContent).toContain('27 °C');
    expect(items[3]?.textContent).toContain('25 °C');
  });

  it('selects the nearest six future periods from a stale timeline', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View
        data={createEnvelope('STALE')}
        error={null}
        isPending={false}
        now={firstForecastAt + 3 * 60 * 60_000 + 30 * 60_000}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    const items = within(screen.getByRole('list', { name: '서울 시간별 예보' })).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[0]?.textContent).toContain('8월 1일 03시');
    expect(items[0]?.textContent).toContain('24 °C');
    expect(screen.queryByText('7월 31일 23시')).toBeNull();
  });

  it('shows one explicit state when no future periods remain', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View
        data={createEnvelope('STALE')}
        error={null}
        isPending={false}
        now={firstForecastAt + 25 * 60 * 60_000}
        onRetry={vi.fn()}
        region="seoul"
      />,
    );

    expect(screen.getByText('현재 이후 제공할 시간별 예보가 없습니다.')).toBeTruthy();
    expect(screen.queryByText('일부 시간대 자료 없음')).toBeNull();
    expect(screen.queryByRole('list', { name: '서울 시간별 예보' })).toBeNull();
  });

  it('announces partial data when an available period lacks the displayed forecast fields', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    const envelope = createEnvelope();
    const firstPeriod = envelope.data.periods[0];
    if (firstPeriod?.availability !== 'available') {
      throw new TypeError('Forecast fixture must start with an available period');
    }
    Object.assign(firstPeriod, {
      precipitationAmount: null,
      precipitationProbabilityPercent: null,
      precipitationType: null,
      skyCondition: null,
      temperatureCelsius: null,
    });

    render(<View data={envelope} error={null} isPending={false} now={viewNow} onRetry={vi.fn()} region="seoul" />);

    expect(screen.getByRole('status').textContent).toContain('일부 시간대 자료 없음');
  });

  it('labels the ordered list with the selected region name', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View data={createEnvelope()} error={null} isPending={false} now={viewNow} onRetry={vi.fn()} region="busan" />,
    );

    expect(screen.getByRole('list', { name: '부산 시간별 예보' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: '서울 시간별 예보' })).toBeNull();
  });

  it('renders six ordered KST periods in a narrow 2x3 and 2xl 3x2 grid', async () => {
    const View = await requireView();
    if (View === undefined) {
      return;
    }

    render(
      <View data={createEnvelope()} error={null} isPending={false} now={viewNow} onRetry={vi.fn()} region="seoul" />,
    );

    const panel = screen.getByRole('region', { name: '서울 시간별 예보' });
    const list = within(panel).getByRole('list', { name: '서울 시간별 예보' });
    const items = within(list).getAllByRole('listitem');

    expect(items).toHaveLength(6);
    expect(list.classList.contains('grid-cols-2')).toBe(true);
    expect(list.classList.contains('2xl:grid-cols-3')).toBe(true);
    expect(list.classList.contains('overflow-x-auto')).toBe(false);

    const expectedPeriods = [
      ['7월 31일 23시', '28 °C'],
      ['8월 1일 00시', '27 °C'],
      ['8월 1일 01시', '26 °C'],
      ['8월 1일 02시', '25 °C'],
      ['8월 1일 03시', '24 °C'],
      ['8월 1일 04시', '23 °C'],
    ] as const;

    for (const [index, [label, temperature]] of expectedPeriods.entries()) {
      const item = items[index];
      expect(item?.textContent).toContain(label);
      expect(item?.textContent).toContain(temperature);

      const time = item === undefined ? null : within(item).getByText(label);
      expect(time?.tagName).toBe('TIME');
      expect(time?.getAttribute('datetime')).toBe(new Date(firstForecastAt + index * 60 * 60_000).toISOString());
    }

    const freshness = screen.getByText('20:00 발표');
    expect(freshness.tagName).toBe('TIME');
    expect(freshness.getAttribute('datetime')).toBe('2026-07-31T11:00:00.000Z');
    expect(screen.getByText('KMA')).toBeTruthy();
  });
});

describe('WeatherForecastWidget query integration', () => {
  it('exports the public widget and loads its dedicated forecast endpoint fixture', async () => {
    const Widget = await loadWeatherForecastWidget();

    expect(Widget, 'weather-forecast public API must export WeatherForecastWidget').toBeTypeOf('function');
    if (Widget === undefined) {
      return;
    }

    const envelope = createEnvelope();
    vi.spyOn(Date, 'now').mockReturnValue(viewNow);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (requestUrl !== '/api/weather/forecast?region=seoul') {
        throw new Error(`unexpected endpoint: ${requestUrl}`);
      }

      return Response.json(envelope);
    });
    vi.stubGlobal('fetch', fetcher);

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <Widget />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('region', { name: '서울 시간별 예보' })).toBeTruthy();
    expect(await screen.findByText('28 °C')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/weather/forecast?region=seoul',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetcher.mock.calls.some(([input]) => input === '/api/weather?region=seoul')).toBe(false);

    client.clear();
  });

  it('advances the visible forecast window when the next hour begins', async () => {
    const Widget = await loadWeatherForecastWidget();

    expect(Widget).toBeTypeOf('function');
    if (Widget === undefined) {
      return;
    }

    vi.useFakeTimers();
    vi.setSystemTime(viewNow);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(createEnvelope('HIT'))),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <Widget />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByText('7월 31일 23시')).toBeTruthy();

    vi.setSystemTime(firstForecastAt + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.queryByText('7월 31일 23시')).toBeNull();
    expect(screen.getByText('8월 1일 00시')).toBeTruthy();
    client.clear();
  });
});
