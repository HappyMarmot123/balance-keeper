import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KoreaMapSession, KoreaMapViewport } from '../../src/entities/map';
import { KoreaMapLayers } from '../../src/widgets/korea-map/ui/KoreaMapLayers';

const DAY_MS = 24 * 60 * 60_000;
const snapshotTo = Date.parse('2026-08-03T03:00:00.000Z');
const occurredAt = snapshotTo - 60_000;

const viewport: KoreaMapViewport = {
  maximumLatitude: 38,
  maximumLongitude: 128,
  minimumLatitude: 37,
  minimumLongitude: 126,
  zoom: 12,
};

const cctvViewport: KoreaMapViewport = {
  maximumLatitude: 37.6,
  maximumLongitude: 127.1,
  minimumLatitude: 37.4,
  minimumLongitude: 126.9,
  zoom: 12,
};

const layerLabels = [
  'CCTV',
  '대기질',
  '지진',
  '돌발상황',
  '도로 재난',
  '도로전광표지',
  '주의운전',
  '가변속도',
] as const;

const earthquakeEnvelope = {
  data: {
    coverage: {
      maximumLatitude: 45,
      maximumLongitude: 145,
      minimumLatitude: 21,
      minimumLongitude: 110,
    },
    events: [
      {
        depthKm: 8,
        id: 'kma:notice-1',
        intensity: null,
        latitude: 37.5,
        location: '가상 해역',
        longitude: 127,
        magnitude: 3.2,
        magnitudeType: null,
        occurredAt,
        sourceRefs: [
          {
            aliases: ['notice-1'],
            depthKm: 8,
            id: 'notice-1',
            intensity: null,
            latitude: 37.5,
            location: '가상 해역',
            longitude: 127,
            magnitude: 3.2,
            magnitudeType: null,
            occurredAt,
            provider: 'KMA',
            updatedAt: occurredAt,
          },
        ],
        updatedAt: occurredAt,
      },
    ],
    sources: {
      kma: { from: snapshotTo - 3 * DAY_MS, status: 'available', to: snapshotTo },
      usgs: { from: snapshotTo - 7 * DAY_MS, status: 'unavailable', to: snapshotTo },
    },
    window: { from: snapshotTo - 7 * DAY_MS, to: snapshotTo },
  },
  meta: {
    cache: 'MISS',
    fetchedAt: snapshotTo,
    requestId: 'map-earthquake-success',
    source: 'KMA+USGS',
  },
} as const;

type PointLayerSpy = Readonly<{
  destroy: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
}>;

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function sessionFixture(initialViewport: KoreaMapViewport = viewport) {
  const pointLayers: PointLayerSpy[] = [];
  const pointSelectHandlers: Array<(id: string) => void> = [];
  const unsubscribeViewport = vi.fn();
  const subscribeViewport = vi.fn((listener: (nextViewport: KoreaMapViewport) => void) => {
    listener(initialViewport);
    return unsubscribeViewport;
  });
  const createPointLayer = vi.fn(({ onSelect }: Readonly<{ onSelect: (id: string) => void }>) => {
    const layer: PointLayerSpy = {
      destroy: vi.fn(),
      replace: vi.fn(),
      select: vi.fn(),
    };
    pointSelectHandlers.push(onSelect);
    pointLayers.push(layer);
    return layer;
  });
  const session = {
    createGeometryLayer: vi.fn(() => ({ destroy: vi.fn(), replace: vi.fn(), select: vi.fn() })),
    createPointLayer,
    destroy: vi.fn(),
    ready: Promise.resolve(),
    resetView: vi.fn(),
    subscribeViewport,
  } as unknown as KoreaMapSession;

  return { createPointLayer, pointLayers, pointSelectHandlers, session, subscribeViewport, unsubscribeViewport };
}

function renderLayers(session: KoreaMapSession) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
  return Object.assign(
    render(
      <QueryClientProvider client={queryClient}>
        <KoreaMapLayers session={session} />
      </QueryClientProvider>,
    ),
    { queryClient },
  );
}

function openLayerMenu(): HTMLElement {
  const trigger = screen.getByRole('button', { name: /지도 레이어/u });
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  return trigger;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('KoreaMapLayers', () => {
  it('offers eight pressed-state layer controls and returns focus when Escape closes the compact menu', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { session } = sessionFixture();
    renderLayers(session);

    const trigger = screen.getByRole('button', { name: /지도 레이어/u });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    openLayerMenu();

    for (const label of layerLabels) {
      const layerButton = screen.getByRole('button', { name: label });
      expect(layerButton.getAttribute('aria-pressed')).toBe('false');
    }

    const firstLayerButton = screen.getByRole('button', { name: layerLabels[0] });
    firstLayerButton.focus();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('subscribes to the viewport once and starts only the query and overlay selected by its toggle', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(
        url === '/api/earthquake'
          ? response(earthquakeEnvelope)
          : response({ error: { code: 'NOT_FOUND', requestId: 'unexpected-map-request' } }, 404),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const { createPointLayer, pointLayers, session, subscribeViewport } = sessionFixture();
    renderLayers(session);

    expect(subscribeViewport).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: '지진' }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('/api/earthquake');
    await waitFor(() => expect(createPointLayer).toHaveBeenCalledOnce());
    await waitFor(() => expect(pointLayers[0]?.replace).toHaveBeenCalledOnce());
    expect(pointLayers[0]?.replace).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'kma:notice-1', latitude: 37.5, longitude: 127 }),
    ]);
    expect(screen.getByRole('button', { name: '지진' }).getAttribute('aria-pressed')).toBe('true');
  });

  it.each([
    ['CCTV', cctvViewport, ['/api/cctv/list?bbox=126.9,37.4,127.1,37.6']],
    [
      '대기질',
      viewport,
      ['busan', 'daegu', 'daejeon', 'gwangju', 'incheon', 'jeju', 'seoul'].map((region) => `/api/air?region=${region}`),
    ],
    ['지진', viewport, ['/api/earthquake']],
    ['돌발상황', viewport, ['/api/road-events/incidents']],
    ['도로 재난', viewport, ['/api/road-events/disasters']],
    ['도로전광표지', viewport, ['/api/road-guidance/vms']],
    ['주의운전', viewport, ['/api/road-guidance/safety-notices']],
    ['가변속도', viewport, ['/api/road-guidance/variable-speed-limits']],
  ] as const)('activates only the %s source after its toggle', async (label, initialViewport, expectedUrls) => {
    const fetcher = vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetcher);
    const { session } = sessionFixture(initialViewport);
    renderLayers(session);

    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: label }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(expectedUrls.length));
    expect(fetcher.mock.calls.map(([input]) => String(input)).sort()).toEqual([...expectedUrls].sort());
  });

  it('destroys an overlay when toggled off and destroys the replacement plus viewport subscription on unmount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(earthquakeEnvelope)),
    );
    const { pointLayers, session, unsubscribeViewport } = sessionFixture();
    const view = renderLayers(session);
    openLayerMenu();
    const earthquakeToggle = screen.getByRole('button', { name: '지진' });

    fireEvent.click(earthquakeToggle);
    await waitFor(() => expect(pointLayers).toHaveLength(1));
    fireEvent.click(earthquakeToggle);
    expect(pointLayers[0]?.destroy).toHaveBeenCalledOnce();

    fireEvent.click(earthquakeToggle);
    await waitFor(() => expect(pointLayers).toHaveLength(2));
    view.unmount();

    expect(pointLayers[0]?.destroy).toHaveBeenCalledOnce();
    expect(pointLayers[1]?.destroy).toHaveBeenCalledOnce();
    expect(unsubscribeViewport).toHaveBeenCalledOnce();
  });

  it('keeps a successful layer and its single data rail visible when another active layer fails', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/earthquake') {
        return Promise.resolve(response(earthquakeEnvelope));
      }
      if (url === '/api/road-guidance/vms') {
        return Promise.resolve(response({ error: { code: 'FORBIDDEN', requestId: 'map-vms-failure' } }, 403));
      }
      return Promise.resolve(response({ error: { code: 'NOT_FOUND', requestId: 'unexpected-map-request' } }, 404));
    });
    vi.stubGlobal('fetch', fetcher);
    const { pointLayers, session } = sessionFixture();
    renderLayers(session);
    openLayerMenu();

    fireEvent.click(screen.getByRole('button', { name: '지진' }));
    expect(await screen.findByText('가상 해역')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '도로전광표지' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('도로전광표지');
    expect(alert.textContent).toContain('불러오지 못했습니다');
    expect(screen.getByText('가상 해역')).toBeTruthy();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(pointLayers[0]?.destroy).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual(['/api/earthquake', '/api/road-guidance/vms']);
  });

  it('keeps stale partial earthquake data visible and exposes one keyboard detail path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          ...earthquakeEnvelope,
          meta: { ...earthquakeEnvelope.meta, cache: 'STALE', requestId: 'map-earthquake-stale' },
        }),
      ),
    );
    const { pointSelectHandlers, session } = sessionFixture();
    renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: '지진' }));

    expect(await screen.findByText('가상 해역')).toBeTruthy();
    expect(screen.getByText('일부 소스만 표시합니다.')).toBeTruthy();
    expect(screen.getByText(/마지막으로 확인된 결과/u)).toBeTruthy();
    const lifecycleStatus = screen.getByRole('status');
    expect(lifecycleStatus.textContent).toContain('1건');
    expect(lifecycleStatus.textContent).toContain('일부 소스만 표시합니다.');
    expect(lifecycleStatus.textContent).toContain('마지막으로 확인된 결과입니다.');
    const rail = screen.getByRole('complementary', { name: '지도 데이터 목록' });
    expect(rail.classList.contains('overflow-y-auto')).toBe(true);
    await waitFor(() => expect(pointSelectHandlers).toHaveLength(1));
    act(() => pointSelectHandlers[0]?.('kma:notice-1'));

    expect(screen.getByRole('region', { name: '가상 해역 상세' })).toBeTruthy();
    const detailClose = screen.getByRole('button', { name: '가상 해역 상세 닫기' });
    const detailContent = screen.getByRole('region', { name: '가상 해역 상세 내용' });
    expect(detailContent.getAttribute('tabindex')).toBe('0');

    const menuLayerButton = screen.getByRole('button', { name: '대기질' });
    menuLayerButton.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('region', { name: '가상 해역 상세' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /지도 레이어/u }).getAttribute('aria-expanded')).toBe('false');

    detailClose.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '지진 규모 3.2, 가상 해역' }));
  });

  it('moves focus to the stable layer rail when a selected item disappears after refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(earthquakeEnvelope)),
    );
    const { session } = sessionFixture();
    const view = renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: '지진' }));
    const itemButton = await screen.findByRole('button', { name: '지진 규모 3.2, 가상 해역' });
    fireEvent.click(itemButton);
    expect(screen.getByRole('region', { name: '가상 해역 상세' })).toBeTruthy();

    act(() => {
      view.queryClient.setQueryData(['earthquakes'], {
        ...earthquakeEnvelope,
        data: { ...earthquakeEnvelope.data, events: [] },
        meta: { ...earthquakeEnvelope.meta, requestId: 'map-earthquake-empty-refresh' },
      });
    });

    await waitFor(() => expect(screen.queryByRole('region', { name: '가상 해역 상세' })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('complementary', { name: '지도 데이터 목록' })),
    );
  });

  it('does not revive an overlay when a pending request resolves after its layer was disabled', async () => {
    let resolveRequest: (value: Response) => void = () => undefined;
    const pendingRequest = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetcher = vi.fn((_input: RequestInfo | URL) => pendingRequest);
    vi.stubGlobal('fetch', fetcher);
    const { createPointLayer, session } = sessionFixture();
    renderLayers(session);
    openLayerMenu();
    const earthquakeToggle = screen.getByRole('button', { name: '지진' });

    fireEvent.click(earthquakeToggle);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    fireEvent.click(earthquakeToggle);
    await act(async () => resolveRequest(response(earthquakeEnvelope)));

    expect(earthquakeToggle.getAttribute('aria-pressed')).toBe('false');
    expect(createPointLayer).not.toHaveBeenCalled();
    expect(screen.queryByRole('complementary', { name: '지도 데이터 목록' })).toBeNull();
  });

  it('shows a non-retryable setup state without hiding the layer rail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: { code: 'MISSING_CREDENTIALS', requestId: 'map-safety-setup' } }, 503)),
    );
    const { session } = sessionFixture();
    renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: '주의운전' }));

    await screen.findByText('주의운전 연결 설정이 필요합니다. 관리자에게 문의하세요.');
    const setupStatus = screen.getByRole('status');
    expect(setupStatus.textContent).toBe('주의운전 연결 설정이 필요합니다. 관리자에게 문의하세요.');
    expect(screen.getByRole('complementary', { name: '지도 데이터 목록' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '주의운전 다시 시도' })).toBeNull();
  });

  it('announces a current layer failure once and offers an explicit retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: { code: 'FORBIDDEN', requestId: 'map-earthquake-error' } }, 403)),
    );
    const { session } = sessionFixture();
    renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: '지진' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('지진 정보를 불러오지 못했습니다.');
    expect(screen.getByRole('button', { name: '지진 다시 시도' })).toBeTruthy();
  });

  it('suppresses all 101 dense VMS points instead of presenting a truncated subset', async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      id: `its-road-guidance:vms:${index.toString().padStart(32, '0')}`,
      pages: [{ lines: [`안내 ${index}`], order: 1 }],
      position: [127, 37.5] as const,
      sourceTimestamp: '20260803120000',
      timeBasis: 'provider-local-unspecified' as const,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          data: { channel: 'vms', generatedAt: snapshotTo, items },
          meta: {
            cache: 'MISS',
            fetchedAt: snapshotTo,
            requestId: 'map-vms-budget',
            source: 'ITS 국가교통정보센터',
          },
        }),
      ),
    );
    const { createPointLayer, session } = sessionFixture();
    renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: '도로전광표지' }));

    expect(await screen.findByText('101건으로 표시 예산을 초과했습니다. 지도를 더 확대하세요.')).toBeTruthy();
    expect(createPointLayer).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /도로전광표지: 안내/u })).toBeNull();
  });

  it('opens the central CCTV live viewer only after selection and restores list focus on close', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const camera = {
      id: 'its-cctv:AbCdEfGhIjKlMnOp',
      latitude: 37.5,
      longitude: 127,
      media: {
        liveHls: {
          createdAt: null,
          resolution: null,
          url: `https://cctvsec.ktict.co.kr/4003/${'A'.repeat(107)}=`,
        },
        stillImage: {
          createdAt: null,
          resolution: null,
          url: `https://cctvsec.ktict.co.kr:8091/4003/${'B'.repeat(86)}==`,
        },
      },
      name: '서울고속도로 CCTV',
      roadSectionId: 'road-a',
      roadType: 'expressway',
    } as const;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/cctv/list?')) {
        return Promise.resolve(
          response({
            data: {
              bounds: {
                maximumLatitude: 37.6,
                maximumLongitude: 127.1,
                minimumLatitude: 37.4,
                minimumLongitude: 126.9,
              },
              cameras: [camera],
            },
            meta: {
              cache: 'MISS',
              fetchedAt: snapshotTo,
              requestId: 'map-cctv-live-list',
              source: 'ITS 국가교통정보센터',
            },
          }),
        );
      }
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal('fetch', fetcher);
    const { session } = sessionFixture(cctvViewport);
    renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: 'CCTV' }));

    const cameraButton = await screen.findByRole('button', { name: '서울고속도로 CCTV 실시간 영상 보기' });
    const layerTrigger = screen.getByRole('button', { name: /지도 레이어/u });
    expect(fetcher).toHaveBeenCalledOnce();
    fireEvent.click(cameraButton);

    expect(await screen.findByText('실시간 영상에 연결하는 중입니다.')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/api/cctv/stream?cameraId=its-cctv%3AAbCdEfGhIjKlMnOp');
    const viewer = screen.getByRole('dialog', { name: '서울고속도로 CCTV' });
    const closeButton = screen.getByRole('button', { name: '서울고속도로 CCTV 실시간 영상 닫기' });
    const video = screen.getByLabelText('서울고속도로 CCTV 실시간 영상');
    expect(viewer.parentElement?.hasAttribute('data-cctv-modal-backdrop')).toBe(true);
    expect(layerTrigger.closest('[inert]')).toBeTruthy();
    expect(layerTrigger.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(viewer, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(video);
    fireEvent.keyDown(viewer, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);
    fireEvent.click(closeButton);

    expect(screen.queryByLabelText('서울고속도로 CCTV 실시간 영상')).toBeNull();
    expect(layerTrigger.closest('[inert]')).toBeNull();
    expect(layerTrigger.closest('[aria-hidden="true"]')).toBeNull();
    expect(document.activeElement).toBe(cameraButton);
  });

  it('keeps CCTV metadata and viewer input aligned with the last accepted overlay snapshot', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const acceptedCamera = {
      id: 'its-cctv:AbCdEfGhIjKlMnOp',
      latitude: 37.5,
      longitude: 127,
      media: {
        liveHls: {
          createdAt: null,
          resolution: null,
          url: `https://cctvsec.ktict.co.kr/4003/${'A'.repeat(107)}=`,
        },
        stillImage: {
          createdAt: null,
          resolution: null,
          url: `https://cctvsec.ktict.co.kr:8091/4003/${'B'.repeat(86)}==`,
        },
      },
      name: '승인된 CCTV',
      roadSectionId: 'road-accepted',
      roadType: 'expressway',
    } as const;
    const rejectedCamera = {
      ...acceptedCamera,
      id: 'its-cctv:ZyXwVuTsRqPoNmLk',
      name: '거부된 CCTV',
      roadSectionId: 'road-rejected',
    } as const;
    const acceptedEnvelope = {
      data: {
        bounds: {
          maximumLatitude: 37.6,
          maximumLongitude: 127.1,
          minimumLatitude: 37.4,
          minimumLongitude: 126.9,
        },
        cameras: [acceptedCamera],
      },
      meta: {
        cache: 'MISS',
        fetchedAt: snapshotTo,
        requestId: 'map-cctv-accepted',
        source: 'Accepted CCTV',
      },
    } as const;
    const fetcher = vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith('/api/cctv/list?')
        ? Promise.resolve(response(acceptedEnvelope))
        : new Promise<Response>(() => undefined),
    );
    vi.stubGlobal('fetch', fetcher);
    const replace = vi
      .fn()
      .mockReturnValueOnce({ overlayCount: 1, status: 'replaced' })
      .mockReturnValueOnce({ overlayCount: 1, reason: 'RENDER_FAILED', status: 'rejected' });
    const base = sessionFixture(cctvViewport);
    const session = {
      ...base.session,
      createPointLayer: vi.fn(() => ({ destroy: vi.fn(), replace, select: vi.fn() })),
    } as unknown as KoreaMapSession;
    const view = renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: 'CCTV' }));
    expect(await screen.findByText('승인된 CCTV')).toBeTruthy();
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());

    act(() => {
      view.queryClient.setQueryData(['cctv-list', 126.9, 37.4, 127.1, 37.6], {
        data: { ...acceptedEnvelope.data, cameras: [rejectedCamera] },
        meta: {
          ...acceptedEnvelope.meta,
          fetchedAt: snapshotTo + 60_000,
          requestId: 'map-cctv-rejected',
          source: 'Rejected CCTV',
        },
      });
    });

    expect(await screen.findByText('지도 표시를 갱신하지 못해 마지막 결과를 유지합니다.')).toBeTruthy();
    expect(screen.getByText('승인된 CCTV')).toBeTruthy();
    expect(screen.queryByText('거부된 CCTV')).toBeNull();
    expect(screen.getByText(/Accepted CCTV/u)).toBeTruthy();
    expect(screen.queryByText(/Rejected CCTV/u)).toBeNull();

    const rail = screen.getByRole('complementary', { name: '지도 데이터 목록' });
    fireEvent.click(within(rail).getByRole('button', { name: '승인된 CCTV 실시간 영상 보기' }));
    expect(screen.getByRole('dialog', { name: '승인된 CCTV' })).toBeTruthy();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/api/cctv/stream?cameraId=its-cctv%3AAbCdEfGhIjKlMnOp');
    fireEvent.click(screen.getByRole('button', { name: '승인된 CCTV 실시간 영상 닫기' }));
    expect(screen.queryByRole('dialog', { name: '승인된 CCTV' })).toBeNull();
  });

  it('keeps the last accepted map/list snapshot during a render failure and clears the error after recovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(earthquakeEnvelope)),
    );
    const replace = vi
      .fn()
      .mockReturnValueOnce({ overlayCount: 1, status: 'replaced' })
      .mockReturnValueOnce({ overlayCount: 1, reason: 'RENDER_FAILED', status: 'rejected' })
      .mockReturnValueOnce({ overlayCount: 1, status: 'replaced' });
    let markerSelect: (id: string) => void = () => undefined;
    const base = sessionFixture();
    const session = {
      ...base.session,
      createPointLayer: vi.fn(({ onSelect }: Readonly<{ onSelect: (id: string) => void }>) => {
        markerSelect = onSelect;
        return { destroy: vi.fn(), replace, select: vi.fn() };
      }),
    } as unknown as KoreaMapSession;
    const view = renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: '지진' }));
    expect(await screen.findByText('가상 해역')).toBeTruthy();
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());

    const changedEnvelope = {
      ...earthquakeEnvelope,
      data: {
        ...earthquakeEnvelope.data,
        events: [
          {
            ...earthquakeEnvelope.data.events[0],
            id: 'kma:notice-2',
            location: '교체 실패 해역',
          },
        ],
      },
      meta: { ...earthquakeEnvelope.meta, requestId: 'map-earthquake-rejected' },
    };
    act(() => {
      view.queryClient.setQueryData(['earthquakes'], changedEnvelope);
    });

    expect(await screen.findByText('지도 표시를 갱신하지 못해 마지막 결과를 유지합니다.')).toBeTruthy();
    expect(screen.getByText('가상 해역')).toBeTruthy();
    expect(screen.queryByText('교체 실패 해역')).toBeNull();
    act(() => markerSelect('kma:notice-1'));
    expect(screen.getByRole('region', { name: '가상 해역 상세' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '가상 해역 상세' })).toBeNull();
    expect(screen.getByRole('button', { name: /지도 레이어/u }).getAttribute('aria-expanded')).toBe('true');
    act(() => markerSelect('kma:notice-1'));
    fireEvent.click(screen.getByRole('button', { name: '지진 지도 다시 시도' }));

    expect(await screen.findByText('교체 실패 해역')).toBeTruthy();
    expect(screen.queryByText('지도 표시를 갱신하지 못해 마지막 결과를 유지합니다.')).toBeNull();
    expect(screen.queryByText('가상 해역')).toBeNull();
  });

  it('drops a rejected last-good snapshot when the layer no longer has renderable items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(earthquakeEnvelope)),
    );
    const destroy = vi.fn();
    const replace = vi
      .fn()
      .mockReturnValueOnce({ overlayCount: 1, status: 'replaced' })
      .mockReturnValueOnce({ overlayCount: 1, reason: 'RENDER_FAILED', status: 'rejected' });
    const base = sessionFixture();
    const session = {
      ...base.session,
      createPointLayer: vi.fn(() => ({ destroy, replace, select: vi.fn() })),
    } as unknown as KoreaMapSession;
    const view = renderLayers(session);
    openLayerMenu();
    fireEvent.click(screen.getByRole('button', { name: '지진' }));
    expect(await screen.findByText('가상 해역')).toBeTruthy();
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());

    act(() => {
      view.queryClient.setQueryData(['earthquakes'], {
        ...earthquakeEnvelope,
        data: {
          ...earthquakeEnvelope.data,
          events: [{ ...earthquakeEnvelope.data.events[0], id: 'kma:notice-rejected', location: '교체 실패 해역' }],
        },
        meta: { ...earthquakeEnvelope.meta, requestId: 'map-earthquake-rejected-before-empty' },
      });
    });
    expect(await screen.findByText('지도 표시를 갱신하지 못해 마지막 결과를 유지합니다.')).toBeTruthy();

    act(() => {
      view.queryClient.setQueryData(['earthquakes'], {
        ...earthquakeEnvelope,
        data: { ...earthquakeEnvelope.data, events: [] },
        meta: { ...earthquakeEnvelope.meta, requestId: 'map-earthquake-empty-after-rejection' },
      });
    });

    await waitFor(() => expect(screen.queryByText('가상 해역')).toBeNull());
    await waitFor(() => expect(screen.queryByText('지도 표시를 갱신하지 못해 마지막 결과를 유지합니다.')).toBeNull());
    expect(screen.queryByRole('button', { name: '지진 지도 다시 시도' })).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
