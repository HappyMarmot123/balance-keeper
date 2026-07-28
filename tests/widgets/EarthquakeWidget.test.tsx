import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EarthquakeSnapshot } from '../../src/entities/earthquake';
import { AppError, type CacheStatus } from '../../src/shared/contracts';
import { EarthquakeWidget } from '../../src/widgets/earthquake';
import { EarthquakeView } from '../../src/widgets/earthquake/ui/EarthquakeView';

const DAY_MS = 24 * 60 * 60_000;
const snapshotTo = Date.parse('2026-07-28T03:00:00.000Z');
const occurredAt = Date.parse('2026-07-27T03:30:05.120Z');

const snapshotFixture: EarthquakeSnapshot = {
  coverage: {
    maximumLatitude: 45,
    maximumLongitude: 145,
    minimumLatitude: 21,
    minimumLongitude: 110,
  },
  events: [
    {
      depthKm: 11,
      id: 'kma:108:42',
      intensity: '최대진도 III',
      latitude: 37.12,
      location: '충북 가상군 남남서쪽 9km 지역',
      longitude: 127.18,
      magnitude: 3.1,
      magnitudeType: null,
      occurredAt,
      sourceRefs: [
        {
          aliases: ['108:42:202607271235:1', '108:42:202607271245:2'],
          depthKm: 11,
          id: '108:42',
          intensity: '최대진도 III',
          latitude: 37.12,
          location: '충북 가상군 남남서쪽 9km 지역',
          longitude: 127.18,
          magnitude: 3.1,
          magnitudeType: null,
          occurredAt,
          provider: 'KMA',
          updatedAt: Date.parse('2026-07-27T03:45:00.000Z'),
        },
        {
          aliases: ['alias-test-1', 'us-test-1'],
          depthKm: 10,
          id: 'us-test-1',
          intensity: null,
          latitude: 37.11,
          location: 'Synthetic Korea region',
          longitude: 127.19,
          magnitude: 3,
          magnitudeType: 'mb',
          occurredAt: occurredAt - 5_120,
          provider: 'USGS',
          updatedAt: Date.parse('2026-07-27T03:31:00.000Z'),
        },
      ],
      updatedAt: Date.parse('2026-07-27T03:45:00.000Z'),
    },
    {
      depthKm: -1.2,
      id: 'usgs:us-test-2',
      intensity: null,
      latitude: 35.8,
      location: null,
      longitude: 129.2,
      magnitude: null,
      magnitudeType: null,
      occurredAt: Date.parse('2026-07-27T02:30:00.000Z'),
      sourceRefs: [
        {
          aliases: ['us-test-2'],
          depthKm: -1.2,
          id: 'us-test-2',
          intensity: null,
          latitude: 35.8,
          location: null,
          longitude: 129.2,
          magnitude: null,
          magnitudeType: null,
          occurredAt: Date.parse('2026-07-27T02:30:00.000Z'),
          provider: 'USGS',
          updatedAt: Date.parse('2026-07-27T02:31:00.000Z'),
        },
      ],
      updatedAt: Date.parse('2026-07-27T02:31:00.000Z'),
    },
  ],
  sources: {
    kma: { from: snapshotTo - 3 * DAY_MS, status: 'available', to: snapshotTo },
    usgs: { from: snapshotTo - 7 * DAY_MS, status: 'available', to: snapshotTo },
  },
  window: { from: snapshotTo - 7 * DAY_MS, to: snapshotTo },
};

const envelopeFixture = (cache: CacheStatus = 'MISS', snapshot = snapshotFixture) => ({
  data: snapshot,
  meta: {
    cache,
    fetchedAt: snapshotTo,
    requestId: 'earthquake-request-1',
    source: 'KMA+USGS',
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EarthquakeView', () => {
  it('announces a stable loading panel', () => {
    render(<EarthquakeView data={undefined} error={null} isPending={true} onRetry={vi.fn()} />);

    const panel = screen.getByRole('region', { name: '동아시아 지진' });
    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('데이터를 불러오는 중입니다.');
  });

  it('shows a safe actionable error and retries', () => {
    const onRetry = vi.fn();
    render(
      <EarthquakeView
        data={undefined}
        error={new AppError('UPSTREAM_UNAVAILABLE')}
        isPending={false}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('지진 정보를 불러오지 못했습니다.');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('explains a successful empty snapshot', () => {
    render(
      <EarthquakeView
        data={envelopeFixture('MISS', { ...snapshotFixture, events: [] })}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('최근 제공 범위에 표시할 지진 통보가 없습니다.')).toBeTruthy();
  });

  it('renders magnitude, depth, KST occurrence time and both provider records', () => {
    render(<EarthquakeView data={envelopeFixture()} error={null} isPending={false} onRetry={vi.fn()} />);

    const list = screen.getByRole('list', { name: '최근 지진' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('M 3.1');
    expect(items[0]?.textContent).toContain('충북 가상군 남남서쪽 9km 지역');
    expect(items[0]?.textContent).toContain('깊이 11 km');
    expect(items[0]?.textContent).toContain('07.27 12:30 KST');
    expect(items[0]?.textContent).toContain('KMA · USGS');
    expect(screen.getByText('12:00 수집')).toBeTruthy();
  });

  it('does not convert unknown magnitude or location to reassuring zero values', () => {
    render(<EarthquakeView data={envelopeFixture()} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByText('M —')).toBeTruthy();
    expect(screen.getByText('위치 정보 없음')).toBeTruthy();
    expect(screen.queryByText('M 0')).toBeNull();
    expect(screen.getByText('깊이 -1.2 km')).toBeTruthy();
  });

  it('makes missing KMA configuration visible while retaining USGS events', () => {
    const usgsOnlyEvent = snapshotFixture.events[1];
    if (usgsOnlyEvent === undefined) {
      throw new TypeError('Synthetic earthquake snapshot requires a USGS-only event');
    }
    const partialSnapshot: EarthquakeSnapshot = {
      ...snapshotFixture,
      events: [usgsOnlyEvent],
      sources: {
        ...snapshotFixture.sources,
        kma: { ...snapshotFixture.sources.kma, status: 'missing-credential' },
      },
    };
    render(
      <EarthquakeView
        data={{
          ...envelopeFixture('MISS', partialSnapshot),
          meta: { ...envelopeFixture().meta, source: 'USGS' },
        }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain(
      '기상청 연결 설정이 없어 USGS 최근 7일 자료만 표시합니다.',
    );
    expect(screen.getByText('M —')).toBeTruthy();
  });

  it('keeps gateway stale data visible with collection freshness', () => {
    render(<EarthquakeView data={envelopeFixture('STALE')} error={null} isPending={false} onRetry={vi.fn()} />);

    expect(screen.getByText('M 3.1')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('게이트웨이가 마지막 성공 지진 정보를 제공하고 있습니다.');
    expect(screen.getByText('12:00 수집')).toBeTruthy();
  });

  it('keeps cached events visible when a background refetch fails', () => {
    render(
      <EarthquakeView
        data={envelopeFixture('HIT')}
        error={new AppError('NETWORK_ERROR')}
        isPending={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('M 3.1')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      '새 정보를 가져오지 못해 마지막 성공 지진 정보를 표시합니다.',
    );
  });
});

describe('EarthquakeWidget', () => {
  it('loads the strict snapshot through the public query integration', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(envelopeFixture()), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);

    render(
      <QueryClientProvider client={client}>
        <EarthquakeWidget />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('M 3.1')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/earthquake',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    client.clear();
  });
});
