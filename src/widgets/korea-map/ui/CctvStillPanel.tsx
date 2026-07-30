import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { type CctvBounds, type CctvCamera, fetchCctvStillImage } from '../../../entities/cctv';

type StillState =
  | Readonly<{ kind: 'failed' }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; objectUrl: string }>;

export function CctvStillPanel({
  bounds,
  camera,
  onClose,
}: Readonly<{
  bounds: CctvBounds;
  camera: CctvCamera;
  onClose: () => void;
}>) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<StillState>({ kind: 'loading' });

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setState({ kind: 'loading' });

    void fetchCctvStillImage({ bounds, cameraId: camera.id }, { signal: controller.signal }).then(
      (blob) => {
        if (!active) {
          return;
        }
        try {
          objectUrl = URL.createObjectURL(blob);
          setState({ kind: 'ready', objectUrl });
        } catch {
          setState({ kind: 'failed' });
        }
      },
      () => {
        if (active && !controller.signal.aborted) {
          setState({ kind: 'failed' });
        }
      },
    );

    return () => {
      active = false;
      controller.abort();
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attempt, bounds, camera.id]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <section
      aria-labelledby={titleId}
      className="absolute left-4 right-16 top-44 z-20 max-w-96 overflow-hidden border border-boundary-strong bg-surface-raised lg:left-88 lg:right-auto lg:top-24 lg:w-96"
    >
      <header className="flex items-start justify-between gap-3 border-b border-boundary px-3 py-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-foreground" id={titleId}>
            {camera.name}
          </h3>
          <p className="mt-1 text-xs text-muted">{camera.roadType === 'expressway' ? '고속도로' : '국도'} 정지영상</p>
        </div>
        <button
          aria-label={`${camera.name} 정지영상 닫기`}
          className="rounded-sm border border-boundary-strong px-2 py-1 text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          닫기
        </button>
      </header>

      {state.kind === 'loading' && (
        <p className="grid aspect-video place-items-center px-4 text-sm text-muted" role="status">
          정지영상을 불러오는 중입니다.
        </p>
      )}
      {state.kind === 'failed' && (
        <div className="grid aspect-video place-items-center gap-3 px-4 text-center" role="alert">
          <p className="text-sm text-muted">정지영상을 불러오지 못했습니다.</p>
          <button
            className="rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            정지영상 다시 시도
          </button>
        </div>
      )}
      {state.kind === 'ready' && (
        <img
          alt={`${camera.name} 정지영상`}
          className="aspect-video w-full bg-surface-inset object-contain"
          src={state.objectUrl}
        />
      )}
    </section>
  );
}
