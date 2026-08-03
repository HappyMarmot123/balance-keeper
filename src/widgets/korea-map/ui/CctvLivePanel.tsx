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
  const modalRootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [camera.id]);

  useEffect(() => {
    const modalRoot = modalRootRef.current;
    const parent = modalRoot?.parentElement;
    if (modalRoot === null || parent === undefined || parent === null) {
      return;
    }

    const backgroundElements = Array.from(parent.children).filter((element) => element !== modalRoot);
    const priorState = backgroundElements.map((element) => ({
      ariaHidden: element.getAttribute('aria-hidden'),
      element,
      inert: element.hasAttribute('inert'),
    }));
    for (const { element } of priorState) {
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    }

    return () => {
      for (const { ariaHidden, element, inert } of priorState) {
        if (ariaHidden === null) {
          element.removeAttribute('aria-hidden');
        } else {
          element.setAttribute('aria-hidden', ariaHidden);
        }
        if (!inert) {
          element.removeAttribute('inert');
        }
      }
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelRef.current?.contains(document.activeElement) === true) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), video[controls]') ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      closeButtonRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="absolute inset-0 z-40 bg-canvas/80" data-cctv-modal-backdrop="" ref={modalRootRef}>
      <section
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute left-4 right-16 top-44 max-w-96 overflow-hidden border border-boundary-strong bg-surface-raised lg:left-88 lg:right-auto lg:top-24 lg:w-96"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role="dialog"
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
    </div>
  );
}
