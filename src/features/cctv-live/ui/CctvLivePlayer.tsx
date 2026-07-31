import type { HlsConfig } from 'hls.js';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type CctvLiveSource, type CctvLiveStreamReference, fetchCctvLiveSource } from '../../../entities/cctv';
import { createCctvHlsBoundaryLoader } from '../model/cctvHlsBoundary';

type HlsErrorData = Readonly<{ fatal: boolean }>;

type HlsInstance = Readonly<{
  attachMedia(video: HTMLVideoElement): void;
  destroy(): void;
  loadSource(url: string): void;
  on(event: string, handler: (event: string, data: HlsErrorData) => void): void;
}>;

interface HlsConstructor {
  readonly Events: Readonly<{
    ERROR: string;
    MANIFEST_PARSED: string;
  }>;
  isSupported(): boolean;
  new (
    config?: Readonly<{
      fLoader: unknown;
      loader: unknown;
      pLoader: unknown;
      progressive: false;
    }>,
  ): HlsInstance;
}

type CctvLivePlayerDependencies = Readonly<{
  loadHls: () => Promise<
    Readonly<{
      FetchLoader: unknown;
      Hls: HlsConstructor;
    }>
  >;
  loadSource: (
    reference: CctvLiveStreamReference,
    options: Readonly<{ signal: AbortSignal }>,
  ) => Promise<CctvLiveSource>;
}>;

type PlayerState = 'connecting' | 'failed' | 'ready' | 'unsupported';

const defaultDependencies: CctvLivePlayerDependencies = Object.freeze({
  async loadHls() {
    const module = await import('hls.js');
    return {
      FetchLoader: module.FetchLoader,
      Hls: module.default as unknown as HlsConstructor,
    };
  },
  loadSource: fetchCctvLiveSource,
});

export function CctvLivePlayer({
  accessibleName,
  dependencies = defaultDependencies,
  reference,
}: Readonly<{
  accessibleName: string;
  dependencies?: CctvLivePlayerDependencies;
  reference: CctvLiveStreamReference;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PlayerState>('connecting');
  const activeRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    let hls: HlsInstance | undefined;
    let mediaReset = false;
    let playbackEnded = false;
    activeRef.current = true;
    setState('connecting');

    const resetMedia = () => {
      hls?.destroy();
      hls = undefined;
      if (mediaReset) {
        return;
      }
      mediaReset = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const fail = () => {
      if (!active || playbackEnded) {
        return;
      }
      playbackEnded = true;
      activeRef.current = false;
      resetMedia();
      setState('failed');
    };
    video.addEventListener('error', fail);

    void dependencies.loadSource(reference, { signal: controller.signal }).then(
      async ({ url }) => {
        if (!active || playbackEnded) {
          return;
        }

        let hlsRuntime: Awaited<ReturnType<CctvLivePlayerDependencies['loadHls']>>;
        try {
          hlsRuntime = await dependencies.loadHls();
        } catch {
          fail();
          return;
        }
        if (!active || playbackEnded) {
          return;
        }
        try {
          const { FetchLoader, Hls } = hlsRuntime;
          if (!Hls.isSupported()) {
            playbackEnded = true;
            activeRef.current = false;
            resetMedia();
            setState('unsupported');
            return;
          }

          const boundaryLoader = createCctvHlsBoundaryLoader(FetchLoader as HlsConfig['loader']);
          const player = new Hls({
            fLoader: boundaryLoader,
            loader: boundaryLoader,
            pLoader: boundaryLoader,
            progressive: false,
          });
          hls = player;
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              fail();
            }
          });
          player.on(Hls.Events.MANIFEST_PARSED, () => {
            if (active && !playbackEnded) {
              setState('ready');
            }
          });
          player.attachMedia(video);
          player.loadSource(url);
        } catch {
          fail();
        }
      },
      () => {
        if (active && !controller.signal.aborted) {
          fail();
        }
      },
    );

    return () => {
      active = false;
      activeRef.current = false;
      video.removeEventListener('error', fail);
      controller.abort();
      resetMedia();
    };
  }, [
    attempt,
    dependencies,
    reference.bounds.maximumLatitude,
    reference.bounds.maximumLongitude,
    reference.bounds.minimumLatitude,
    reference.bounds.minimumLongitude,
    reference.cameraId,
  ]);

  return (
    <div className="relative aspect-video bg-surface-inset">
      <video
        aria-label={accessibleName}
        className="h-full w-full object-contain"
        controls
        muted
        onCanPlay={() => {
          if (activeRef.current) {
            setState('ready');
          }
        }}
        playsInline
        preload="metadata"
        ref={videoRef}
      />

      {state === 'connecting' && (
        <p
          className="pointer-events-none absolute inset-x-3 top-3 bg-surface-raised px-3 py-2 text-center text-sm text-muted"
          role="status"
        >
          실시간 영상에 연결하는 중입니다.
        </p>
      )}
      {state === 'ready' && (
        <p className="sr-only" role="status">
          실시간 영상이 준비되었습니다.
        </p>
      )}
      {state === 'unsupported' && (
        <p
          className="absolute inset-x-3 top-3 bg-surface-raised px-3 py-2 text-center text-sm text-foreground"
          role="alert"
        >
          이 브라우저에서는 실시간 영상을 재생할 수 없습니다.
        </p>
      )}
      {state === 'failed' && (
        <div className="absolute inset-x-3 top-3 grid gap-2 bg-surface-raised px-3 py-2 text-center" role="alert">
          <p className="text-sm text-foreground">실시간 영상을 불러오지 못했습니다.</p>
          <button
            className="justify-self-center rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            실시간 영상 다시 시도
          </button>
        </div>
      )}
    </div>
  );
}
