import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KoreaMapSession, KoreaMapViewport } from '../../src/entities/map';
import { CctvMapLayer } from '../../src/widgets/korea-map/ui/CctvMapLayer';

vi.mock('hls.js', () => {
  class FakeFetchLoader {}
  class FakeHls {
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
    static isSupported = () => true;
    private readonly handlers = new Map<string, (event: string, data: { fatal: boolean }) => void>();

    attachMedia() {}
    destroy() {}
    loadSource() {
      this.handlers.get(FakeHls.Events.MANIFEST_PARSED)?.('manifestParsed', { fatal: false });
    }
    on(event: string, handler: (event: string, data: { fatal: boolean }) => void) {
      this.handlers.set(event, handler);
    }
  }
  return { default: FakeHls, FetchLoader: FakeFetchLoader };
});

const viewport: KoreaMapViewport = {
  maximumLatitude: 37.6,
  maximumLongitude: 127.1,
  minimumLatitude: 37.4,
  minimumLongitude: 126.9,
  zoom: 12,
};

const emptyEnvelope = {
  data: {
    bounds: {
      maximumLatitude: 37.6,
      maximumLongitude: 127.1,
      minimumLatitude: 37.4,
      minimumLongitude: 126.9,
    },
    cameras: [],
  },
  meta: {
    cache: 'MISS',
    fetchedAt: 1_785_360_000_000,
    requestId: 'request-cctv-empty',
    source: 'ITS 국가교통정보센터',
  },
} as const;

const cameraFixture = {
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

function deferred<Value>() {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

const liveSourceEnvelope = (
  url: string = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-default-signature',
) => ({
  data: { url },
  meta: {
    cache: 'MISS',
    fetchedAt: 1_785_360_000_000,
    requestId: 'request-cctv-live-source',
    source: 'ITS 국가교통정보센터',
  },
});

function sessionFixture(): KoreaMapSession {
  return {
    createPointLayer: vi.fn(() => ({ destroy: vi.fn(), replace: vi.fn(), select: vi.fn() })),
    destroy: vi.fn(),
    ready: Promise.resolve(),
    resetView: vi.fn(),
    subscribeViewport: vi.fn((listener) => {
      listener(viewport);
      return vi.fn();
    }),
  };
}

function renderLayer(session = sessionFixture()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY, retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <CctvMapLayer active={true} session={session} />
      </QueryClientProvider>,
    ),
    queryClient,
    session,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

describe('CctvMapLayer', () => {
  it('explains a list failure, retries explicitly, and distinguishes a successful empty viewport', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: 'FORBIDDEN',
              requestId: 'request-cctv-failed',
            },
          },
          403,
        ),
      )
      .mockResolvedValueOnce(response(emptyEnvelope));
    vi.stubGlobal('fetch', fetcher);
    renderLayer();

    expect((await screen.findByRole('alert')).textContent).toContain('CCTV 위치를 불러오지 못했습니다.');
    fireEvent.click(screen.getByRole('button', { name: 'CCTV 위치 다시 시도' }));

    expect(await screen.findByText('현재 화면에 제공되는 CCTV가 없습니다.')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shows a non-retryable setup state when the server credential is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          {
            error: {
              code: 'MISSING_CREDENTIALS',
              requestId: 'request-cctv-setup',
            },
          },
          503,
        ),
      ),
    );
    renderLayer();

    expect(await screen.findByText('CCTV 연결 설정이 필요합니다. 관리자에게 문의하세요.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'CCTV 위치 다시 시도' })).toBeNull();
  });

  it('keeps stale CCTV positions visible with provider freshness instead of presenting them as current', async () => {
    const staleEnvelope = {
      ...emptyEnvelope,
      data: {
        ...emptyEnvelope.data,
        cameras: [cameraFixture],
      },
      meta: {
        ...emptyEnvelope.meta,
        cache: 'STALE',
        requestId: 'request-cctv-stale',
      },
    } as const;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(staleEnvelope)),
    );
    renderLayer();

    expect(await screen.findByText('현재 화면 · 1대')).toBeTruthy();
    expect(screen.getByText('마지막으로 확인된 CCTV 위치입니다.')).toBeTruthy();
    expect(screen.getByText('ITS 국가교통정보센터')).toBeTruthy();
    expect(screen.getByText('ITS 국가교통정보센터').closest('time')?.getAttribute('datetime')).toBe(
      new Date(staleEnvelope.meta.fetchedAt).toISOString(),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('loads one fresh live source only after selection and tears down the video on close', async () => {
    const successEnvelope = {
      ...emptyEnvelope,
      data: {
        ...emptyEnvelope.data,
        cameras: [cameraFixture],
      },
      meta: {
        ...emptyEnvelope.meta,
        requestId: 'request-cctv-live-selection',
      },
    } as const;
    const freshLiveUrl = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-fresh-signature';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(successEnvelope))
      .mockResolvedValueOnce(response(liveSourceEnvelope(freshLiveUrl)));
    vi.stubGlobal('fetch', fetcher);
    const replace = vi.fn();
    const select = vi.fn();
    const session = {
      ...sessionFixture(),
      createPointLayer: vi.fn(() => ({ destroy: vi.fn(), replace, select })),
    } satisfies KoreaMapSession;
    renderLayer(session);

    const cameraButton = await screen.findByRole('button', {
      name: '서울고속도로 CCTV 실시간 영상 보기',
    });
    await waitFor(() => expect(replace.mock.lastCall?.[0]).toHaveLength(1));
    const markerReplacementCount = replace.mock.calls.length;
    expect(fetcher).toHaveBeenCalledOnce();
    fireEvent.click(cameraButton);

    expect(await screen.findByText('실시간 영상에 연결하는 중입니다.')).toBeTruthy();
    expect(replace).toHaveBeenCalledTimes(markerReplacementCount);
    expect(select).toHaveBeenLastCalledWith(cameraFixture.id);
    const liveHeading = screen.getByRole('heading', { name: cameraFixture.name });
    expect(liveHeading.className).toContain('break-words');
    expect(liveHeading.parentElement?.className).toContain('min-w-0');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '서울고속도로 CCTV 실시간 영상 닫기' }));
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/cctv/stream?cameraId=its-cctv%3AAbCdEfGhIjKlMnOp&bbox=126.9,37.4,127.1,37.6',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
    const video = screen.getByLabelText('서울고속도로 CCTV 실시간 영상') as HTMLVideoElement;
    expect(await screen.findByText('실시간 영상이 준비되었습니다.')).toBeTruthy();
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.controls).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(fetcher.mock.calls.some(([input]) => String(input).startsWith('/api/cctv/image?'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '서울고속도로 CCTV 실시간 영상 닫기' }));
    expect(screen.queryByLabelText('서울고속도로 CCTV 실시간 영상')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '서울고속도로 CCTV 실시간 영상 보기' }));
  });

  it('replaces the list with one live viewer, retries a fresh source failure, and closes with Escape', async () => {
    const nextCamera = {
      ...cameraFixture,
      id: 'its-cctv:ZyXwVuTsRqPoNmLk',
      name: '서울국도 CCTV',
      roadType: 'national-road' as const,
    };
    const successEnvelope = {
      ...emptyEnvelope,
      data: {
        ...emptyEnvelope.data,
        cameras: [cameraFixture, nextCamera],
      },
      meta: {
        ...emptyEnvelope.meta,
        requestId: 'request-cctv-live-switch',
      },
    } as const;
    const firstLiveUrl = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-first-signature';
    const secondLiveUrl = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-second-signature';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(successEnvelope))
      .mockResolvedValueOnce(response(liveSourceEnvelope(firstLiveUrl)))
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: 'UPSTREAM_UNAVAILABLE',
              requestId: 'request-cctv-live-failed',
            },
          },
          502,
        ),
      )
      .mockResolvedValueOnce(response(liveSourceEnvelope(secondLiveUrl)));
    vi.stubGlobal('fetch', fetcher);
    renderLayer();

    fireEvent.click(await screen.findByRole('button', { name: '서울고속도로 CCTV 실시간 영상 보기' }));
    const firstVideo = screen.getByLabelText('서울고속도로 CCTV 실시간 영상') as HTMLVideoElement;
    expect(await screen.findByText('실시간 영상이 준비되었습니다.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '서울국도 CCTV 실시간 영상 보기' }).closest('aside')?.className,
    ).toContain('hidden');
    fireEvent.click(screen.getByRole('button', { name: '서울고속도로 CCTV 실시간 영상 닫기' }));
    expect(firstVideo.hasAttribute('src')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '서울국도 CCTV 실시간 영상 보기' }));
    expect(await screen.findByText('실시간 영상을 불러오지 못했습니다.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '실시간 영상 다시 시도' }));
    const secondVideo = screen.getByLabelText('서울국도 CCTV 실시간 영상') as HTMLVideoElement;
    expect(await screen.findByText('실시간 영상이 준비되었습니다.')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByLabelText('서울국도 CCTV 실시간 영상')).toBeNull();
    expect(secondVideo.hasAttribute('src')).toBe(false);
  });

  it('caps marker and list overlays at 100 cameras while reporting the full viewport count', async () => {
    const cameras = Array.from({ length: 101 }, (_, index) => ({
      ...cameraFixture,
      id: `its-cctv:${index.toString(36).padStart(16, '0')}`,
      name: `CCTV ${index.toString().padStart(3, '0')}`,
    }));
    const crowdedEnvelope = {
      ...emptyEnvelope,
      data: {
        ...emptyEnvelope.data,
        cameras,
      },
      meta: {
        ...emptyEnvelope.meta,
        requestId: 'request-cctv-crowded',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(crowdedEnvelope)),
    );
    const replace = vi.fn();
    const session = {
      ...sessionFixture(),
      createPointLayer: vi.fn(() => ({ destroy: vi.fn(), replace, select: vi.fn() })),
    } satisfies KoreaMapSession;
    renderLayer(session);

    expect(await screen.findByText('현재 화면 · 101대')).toBeTruthy();
    expect(screen.getByText('100대만 표시합니다. 지도를 더 확대하세요.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /CCTV \d{3} 실시간 영상 보기/u })).toHaveLength(100);
    await waitFor(() => expect(replace.mock.lastCall?.[0]).toHaveLength(100));
  });

  it('keeps the last camera list visible and labels it degraded when a refresh fails', async () => {
    const successEnvelope = {
      ...emptyEnvelope,
      data: {
        ...emptyEnvelope.data,
        cameras: [cameraFixture],
      },
      meta: {
        ...emptyEnvelope.meta,
        cache: 'HIT',
        requestId: 'request-cctv-before-refresh',
      },
    } as const;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(successEnvelope))
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: 'FORBIDDEN',
              requestId: 'request-cctv-refresh-failed',
            },
          },
          403,
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const { queryClient } = renderLayer();

    expect(await screen.findByText('현재 화면 · 1대')).toBeTruthy();
    await queryClient.invalidateQueries({ queryKey: ['cctv-list'] });

    expect(await screen.findByText('CCTV 위치 갱신에 실패해 마지막 결과를 표시합니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '서울고속도로 CCTV 실시간 영상 보기' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aborts a pending live-source request and destroys marker resources when the layer is turned off', async () => {
    const successEnvelope = {
      ...emptyEnvelope,
      data: {
        ...emptyEnvelope.data,
        cameras: [cameraFixture],
      },
      meta: {
        ...emptyEnvelope.meta,
        requestId: 'request-cctv-before-off',
      },
    } as const;
    const pendingSource = deferred<Response>();
    let sourceSignal: AbortSignal | undefined;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(successEnvelope))
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        sourceSignal = init?.signal ?? undefined;
        return pendingSource.promise;
      });
    vi.stubGlobal('fetch', fetcher);
    const destroyPointLayer = vi.fn();
    const session = {
      ...sessionFixture(),
      createPointLayer: vi.fn(() => ({ destroy: destroyPointLayer, replace: vi.fn(), select: vi.fn() })),
    } satisfies KoreaMapSession;
    const view = renderLayer(session);

    fireEvent.click(
      await screen.findByRole('button', {
        name: '서울고속도로 CCTV 실시간 영상 보기',
      }),
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(sourceSignal?.aborted).toBe(false);

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <CctvMapLayer active={false} session={session} />
      </QueryClientProvider>,
    );

    expect(sourceSignal?.aborted).toBe(true);
    expect(destroyPointLayer).toHaveBeenCalledOnce();
    expect(screen.queryByText('실시간 영상에 연결하는 중입니다.')).toBeNull();
  });

  it('clears the selected camera when the viewport changes instead of reopening it from cache', async () => {
    const successEnvelope = {
      ...emptyEnvelope,
      data: {
        ...emptyEnvelope.data,
        cameras: [cameraFixture],
      },
      meta: {
        ...emptyEnvelope.meta,
        requestId: 'request-cctv-selection-viewport-a',
      },
    } as const;
    const nextViewport: KoreaMapViewport = {
      maximumLatitude: 37.8,
      maximumLongitude: 127.3,
      minimumLatitude: 37.6,
      minimumLongitude: 127.1,
      zoom: 12,
    };
    const nextEnvelope = {
      ...emptyEnvelope,
      data: {
        bounds: {
          maximumLatitude: 37.8,
          maximumLongitude: 127.3,
          minimumLatitude: 37.6,
          minimumLongitude: 127.1,
        },
        cameras: [],
      },
      meta: {
        ...emptyEnvelope.meta,
        requestId: 'request-cctv-selection-viewport-b',
      },
    } as const;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/cctv/stream?')) {
        return new Promise<Response>(() => undefined);
      }
      if (url.includes('bbox=127.1,37.6,127.3,37.8')) {
        return Promise.resolve(response(nextEnvelope));
      }
      return Promise.resolve(response(successEnvelope));
    });
    vi.stubGlobal('fetch', fetcher);
    let emitViewport: ((next: KoreaMapViewport) => void) | undefined;
    const session = {
      ...sessionFixture(),
      subscribeViewport: vi.fn((listener: (next: KoreaMapViewport) => void) => {
        emitViewport = listener;
        listener(viewport);
        return vi.fn();
      }),
    } satisfies KoreaMapSession;
    renderLayer(session);

    fireEvent.click(await screen.findByRole('button', { name: '서울고속도로 CCTV 실시간 영상 보기' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith('/api/cctv/stream?'))).toHaveLength(1),
    );

    act(() => emitViewport?.(nextViewport));
    expect(await screen.findByText('현재 화면에 제공되는 CCTV가 없습니다.')).toBeTruthy();
    act(() => emitViewport?.(viewport));
    expect(await screen.findByRole('button', { name: '서울고속도로 CCTV 실시간 영상 보기' })).toBeTruthy();

    expect(screen.queryByText('실시간 영상에 연결하는 중입니다.')).toBeNull();
    expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith('/api/cctv/stream?'))).toHaveLength(1);
  });

  it('clears a selected camera removed by a same-viewport refresh instead of reopening it later', async () => {
    const successEnvelope = {
      ...emptyEnvelope,
      data: {
        ...emptyEnvelope.data,
        cameras: [cameraFixture],
      },
      meta: {
        ...emptyEnvelope.meta,
        requestId: 'request-cctv-selection-refresh',
      },
    } as const;
    const fetcher = vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith('/api/cctv/stream?')
        ? new Promise<Response>(() => undefined)
        : Promise.resolve(response(successEnvelope)),
    );
    vi.stubGlobal('fetch', fetcher);
    const { queryClient } = renderLayer();

    fireEvent.click(await screen.findByRole('button', { name: '서울고속도로 CCTV 실시간 영상 보기' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith('/api/cctv/stream?'))).toHaveLength(1),
    );

    act(() => {
      queryClient.setQueryData(['cctv-list', 126.9, 37.4, 127.1, 37.6], emptyEnvelope);
    });
    expect(await screen.findByText('현재 화면에 제공되는 CCTV가 없습니다.')).toBeTruthy();
    act(() => {
      queryClient.setQueryData(['cctv-list', 126.9, 37.4, 127.1, 37.6], successEnvelope);
    });
    expect(await screen.findByRole('button', { name: '서울고속도로 CCTV 실시간 영상 보기' })).toBeTruthy();

    expect(screen.queryByText('실시간 영상에 연결하는 중입니다.')).toBeNull();
    expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith('/api/cctv/stream?'))).toHaveLength(1);
  });
});
