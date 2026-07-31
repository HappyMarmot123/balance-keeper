import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CctvLiveStreamReference } from '../../src/entities/cctv';
import { CctvLivePlayer } from '../../src/features/cctv-live';

const reference: CctvLiveStreamReference = {
  bounds: {
    maximumLatitude: 37.6,
    maximumLongitude: 127.1,
    minimumLatitude: 37.4,
    minimumLongitude: 126.9,
  },
  cameraId: 'its-cctv:AbCdEfGhIjKlMnOp',
};

const liveUrl = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-master-signature';

type ErrorHandler = (event: string, data: { fatal: boolean }) => void;
type HlsConfigFixture = Readonly<{
  fLoader?: unknown;
  loader?: unknown;
  pLoader?: unknown;
  progressive?: boolean;
}>;

class FakeBaseLoader {}

const mediaSpies = {
  canPlayType: vi.spyOn(HTMLMediaElement.prototype, 'canPlayType'),
  load: vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined),
  pause: vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined),
  play: vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined),
};

beforeEach(() => {
  mediaSpies.canPlayType.mockReset();
  mediaSpies.load.mockClear();
  mediaSpies.pause.mockClear();
  mediaSpies.play.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('CctvLivePlayer', () => {
  it('uses a guarded lazy hls.js loader without autoplay even when native HLS is advertised', async () => {
    mediaSpies.canPlayType.mockReturnValue('probably');
    const loadSource = vi.fn(async () => ({ url: liveUrl }));
    let config: HlsConfigFixture | undefined;
    let instance:
      | {
          attachMedia: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
          loadSource: ReturnType<typeof vi.fn>;
        }
      | undefined;
    class FakeHls {
      static DefaultConfig = { loader: FakeBaseLoader };
      static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
      static isSupported = () => true;
      attachMedia = vi.fn();
      destroy = vi.fn();
      loadSource = vi.fn();
      on = vi.fn();

      constructor(receivedConfig?: HlsConfigFixture) {
        config = receivedConfig;
        instance = this;
      }
    }
    const loadHls = vi.fn(async () => ({ FetchLoader: FakeBaseLoader, Hls: FakeHls }));
    const view = render(
      <CctvLivePlayer
        accessibleName="서울고속도로 CCTV 실시간 영상"
        dependencies={{ loadHls, loadSource }}
        reference={reference}
      />,
    );

    const video = screen.getByLabelText('서울고속도로 CCTV 실시간 영상') as HTMLVideoElement;
    await waitFor(() => expect(instance).toBeDefined());
    expect(video.controls).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.hasAttribute('src')).toBe(false);
    expect(loadHls).toHaveBeenCalledOnce();
    expect(config?.progressive).toBe(false);
    expect(config?.loader).not.toBe(FakeBaseLoader);
    expect(config?.fLoader).toBe(config?.loader);
    expect(config?.pLoader).toBe(config?.loader);
    expect(instance?.attachMedia).toHaveBeenCalledWith(video);
    expect(instance?.loadSource).toHaveBeenCalledWith(liveUrl);
    expect(mediaSpies.play).not.toHaveBeenCalled();

    fireEvent.canPlay(video);
    expect(await screen.findByText('실시간 영상이 준비되었습니다.')).toBeTruthy();

    view.unmount();
    expect(mediaSpies.pause).toHaveBeenCalled();
    expect(mediaSpies.load).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    expect(instance?.destroy).toHaveBeenCalledOnce();
  });

  it('loads hls.js lazily and destroys the only instance on a fatal error before retrying', async () => {
    mediaSpies.canPlayType.mockReturnValue('');
    const instances: Array<{
      attachMedia: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      errorHandler?: ErrorHandler;
      loadSource: ReturnType<typeof vi.fn>;
      manifestHandler?: ErrorHandler;
      on: ReturnType<typeof vi.fn>;
    }> = [];
    class FakeHls {
      static DefaultConfig = { loader: FakeBaseLoader };
      static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
      static isSupported = () => true;
      attachMedia = vi.fn();
      destroy = vi.fn();
      loadSource = vi.fn();
      on = vi.fn((event: string, handler: ErrorHandler) => {
        if (event === FakeHls.Events.ERROR) {
          this.errorHandler = handler;
        }
        if (event === FakeHls.Events.MANIFEST_PARSED) {
          this.manifestHandler = handler;
        }
      });
      errorHandler?: ErrorHandler;
      manifestHandler?: ErrorHandler;

      constructor(_config?: HlsConfigFixture) {
        instances.push(this);
      }
    }
    const loadSource = vi.fn(async () => ({ url: liveUrl }));
    const loadHls = vi.fn(async () => ({ FetchLoader: FakeBaseLoader, Hls: FakeHls }));
    render(
      <CctvLivePlayer
        accessibleName="서울고속도로 CCTV 실시간 영상"
        dependencies={{ loadHls, loadSource }}
        reference={reference}
      />,
    );

    await waitFor(() => expect(instances).toHaveLength(1));
    expect(loadHls).toHaveBeenCalledOnce();
    expect(instances[0]?.attachMedia).toHaveBeenCalledWith(screen.getByLabelText('서울고속도로 CCTV 실시간 영상'));
    expect(instances[0]?.loadSource).toHaveBeenCalledWith(liveUrl);

    instances[0]?.errorHandler?.('error', { fatal: false });
    expect(screen.queryByText('실시간 영상을 불러오지 못했습니다.')).toBeNull();
    instances[0]?.errorHandler?.('error', { fatal: true });
    expect(await screen.findByText('실시간 영상을 불러오지 못했습니다.')).toBeTruthy();
    expect(instances[0]?.destroy).toHaveBeenCalledOnce();

    instances[0]?.manifestHandler?.('manifestParsed', { fatal: false });
    expect(screen.queryByText('실시간 영상이 준비되었습니다.')).toBeNull();
    expect(screen.getByText('실시간 영상을 불러오지 못했습니다.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '실시간 영상 다시 시도' }));
    await waitFor(() => expect(instances).toHaveLength(2));
    expect(loadSource).toHaveBeenCalledTimes(2);
    expect(instances[1]?.loadSource).toHaveBeenCalledWith(liveUrl);
    expect(mediaSpies.play).not.toHaveBeenCalled();
  });

  it('reports an unsupported browser without constructing a player', async () => {
    mediaSpies.canPlayType.mockReturnValue('probably');
    const loadSource = vi.fn(async () => ({ url: liveUrl }));
    const unsupportedHls = class {
      static DefaultConfig = { loader: FakeBaseLoader };
      static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
      static isSupported = () => false;
      attachMedia() {}
      destroy() {}
      loadSource() {}
      on() {}
    };
    const loadHls = vi.fn(async () => ({ FetchLoader: FakeBaseLoader, Hls: unsupportedHls }));

    render(
      <CctvLivePlayer
        accessibleName="서울고속도로 CCTV 실시간 영상"
        dependencies={{ loadHls, loadSource }}
        reference={reference}
      />,
    );

    expect(await screen.findByText('이 브라우저에서는 실시간 영상을 재생할 수 없습니다.')).toBeTruthy();
    expect(mediaSpies.play).not.toHaveBeenCalled();
  });

  it('reports a synchronous player initialization failure and allows retry', async () => {
    mediaSpies.canPlayType.mockReturnValue('');
    let shouldThrow = true;
    const instances: Array<{ loadSource: ReturnType<typeof vi.fn> }> = [];
    class FakeHls {
      static DefaultConfig = { loader: FakeBaseLoader };
      static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
      static isSupported = () => true;
      attachMedia = vi.fn();
      destroy = vi.fn();
      loadSource = vi.fn();
      on = vi.fn();

      constructor(_config?: HlsConfigFixture) {
        if (shouldThrow) {
          shouldThrow = false;
          throw new Error('synchronous constructor failure');
        }
        instances.push(this);
      }
    }
    const loadSource = vi.fn(async () => ({ url: liveUrl }));

    render(
      <CctvLivePlayer
        accessibleName="서울고속도로 CCTV 실시간 영상"
        dependencies={{
          loadHls: async () => ({ FetchLoader: FakeBaseLoader, Hls: FakeHls }),
          loadSource,
        }}
        reference={reference}
      />,
    );

    expect(await screen.findByText('실시간 영상을 불러오지 못했습니다.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '실시간 영상 다시 시도' }));
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(instances[0]?.loadSource).toHaveBeenCalledWith(liveUrl);
    expect(loadSource).toHaveBeenCalledTimes(2);
  });

  it('tears down hls.js when the media element itself reports a playback error', async () => {
    mediaSpies.canPlayType.mockReturnValue('');
    let instance:
      | {
          attachMedia: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
          loadSource: ReturnType<typeof vi.fn>;
          on: ReturnType<typeof vi.fn>;
        }
      | undefined;
    class FakeHls {
      static DefaultConfig = { loader: FakeBaseLoader };
      static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
      static isSupported = () => true;
      attachMedia = vi.fn();
      destroy = vi.fn();
      loadSource = vi.fn();
      on = vi.fn();

      constructor() {
        instance = this;
      }
    }
    render(
      <CctvLivePlayer
        accessibleName="서울고속도로 CCTV 실시간 영상"
        dependencies={{
          loadHls: async () => ({ FetchLoader: FakeBaseLoader, Hls: FakeHls }),
          loadSource: async () => ({ url: liveUrl }),
        }}
        reference={reference}
      />,
    );

    await waitFor(() => expect(instance).toBeDefined());
    fireEvent.error(screen.getByLabelText('서울고속도로 CCTV 실시간 영상'));

    expect(await screen.findByText('실시간 영상을 불러오지 못했습니다.')).toBeTruthy();
    expect(instance?.destroy).toHaveBeenCalledOnce();
  });

  it('does not attach a late lazy-loaded player after the media element already failed', async () => {
    mediaSpies.canPlayType.mockReturnValue('');
    let instanceCount = 0;
    class FakeHls {
      static DefaultConfig = { loader: FakeBaseLoader };
      static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
      static isSupported = () => true;
      attachMedia = vi.fn();
      destroy = vi.fn();
      loadSource = vi.fn();
      on = vi.fn();

      constructor(_config?: HlsConfigFixture) {
        instanceCount += 1;
      }
    }
    type Runtime = Readonly<{ FetchLoader: typeof FakeBaseLoader; Hls: typeof FakeHls }>;
    let resolveRuntime: ((runtime: Runtime) => void) | undefined;
    const loadHls = vi.fn(
      () =>
        new Promise<Runtime>((resolve) => {
          resolveRuntime = resolve;
        }),
    );
    render(
      <CctvLivePlayer
        accessibleName="서울고속도로 CCTV 실시간 영상"
        dependencies={{ loadHls, loadSource: async () => ({ url: liveUrl }) }}
        reference={reference}
      />,
    );

    await waitFor(() => expect(loadHls).toHaveBeenCalledOnce());
    fireEvent.error(screen.getByLabelText('서울고속도로 CCTV 실시간 영상'));
    expect(await screen.findByText('실시간 영상을 불러오지 못했습니다.')).toBeTruthy();
    resolveRuntime?.({ FetchLoader: FakeBaseLoader, Hls: FakeHls });

    await Promise.resolve();
    expect(instanceCount).toBe(0);
  });

  it('destroys the old hls.js instance when switching cameras and on final unmount', async () => {
    mediaSpies.canPlayType.mockReturnValue('');
    const instances: Array<{
      destroy: ReturnType<typeof vi.fn>;
      loadSource: ReturnType<typeof vi.fn>;
    }> = [];
    class FakeHls {
      static DefaultConfig = { loader: FakeBaseLoader };
      static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
      static isSupported = () => true;
      attachMedia = vi.fn();
      destroy = vi.fn();
      loadSource = vi.fn();
      on = vi.fn();

      constructor(_config?: HlsConfigFixture) {
        instances.push(this);
      }
    }
    const loadSource = vi.fn(async () => ({ url: liveUrl }));
    const dependencies = {
      loadHls: async () => ({ FetchLoader: FakeBaseLoader, Hls: FakeHls }),
      loadSource,
    };
    const view = render(
      <CctvLivePlayer
        accessibleName="서울고속도로 CCTV 실시간 영상"
        dependencies={dependencies}
        reference={reference}
      />,
    );

    await waitFor(() => expect(instances).toHaveLength(1));
    view.rerender(
      <CctvLivePlayer
        accessibleName="서울국도 CCTV 실시간 영상"
        dependencies={dependencies}
        reference={{ ...reference, cameraId: 'its-cctv:QbCdEfGhIjKlMnOp' }}
      />,
    );

    await waitFor(() => expect(instances).toHaveLength(2));
    expect(instances[0]?.destroy).toHaveBeenCalledOnce();
    expect(instances[1]?.loadSource).toHaveBeenCalledWith(liveUrl);

    view.unmount();
    expect(instances[1]?.destroy).toHaveBeenCalledOnce();
    expect(mediaSpies.pause).toHaveBeenCalled();
    expect(mediaSpies.load).toHaveBeenCalled();
  });
});
