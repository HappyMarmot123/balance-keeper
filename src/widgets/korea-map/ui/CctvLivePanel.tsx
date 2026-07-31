import { useEffect, useId, useRef } from 'preact/hooks';

import type { CctvBounds, CctvCamera } from '../../../entities/cctv';
import { CctvLivePlayer } from '../../../features/cctv-live';

export function CctvLivePanel({
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

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

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
          <p className="mt-1 text-xs text-muted">
            {camera.roadType === 'expressway' ? '고속도로' : '국도'} 실시간 영상
          </p>
        </div>
        <button
          aria-label={`${camera.name} 실시간 영상 닫기`}
          className="rounded-sm border border-boundary-strong px-2 py-1 text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          닫기
        </button>
      </header>

      <CctvLivePlayer accessibleName={`${camera.name} 실시간 영상`} reference={{ bounds, cameraId: camera.id }} />
    </section>
  );
}
