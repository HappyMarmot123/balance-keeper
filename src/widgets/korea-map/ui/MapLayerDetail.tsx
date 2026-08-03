import { useEffect, useRef } from 'preact/hooks';

import type { MapLayerItem } from '../model/mapLayerItems';

export function MapLayerDetail({ item, onClose }: Readonly<{ item: MapLayerItem; onClose: () => void }>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => closeRef.current?.focus(), [item.id]);
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

  return (
    <section
      aria-label={`${item.title} 상세`}
      className="absolute left-4 right-16 top-44 z-20 max-h-96 max-w-96 overflow-hidden border border-boundary-strong bg-surface-raised lg:left-88 lg:right-auto lg:top-24 lg:w-96"
      ref={panelRef}
    >
      <header className="flex items-start justify-between gap-3 border-b border-boundary px-3 py-2">
        <h3 className="break-words text-sm font-semibold text-foreground">{item.title}</h3>
        <button
          aria-label={`${item.title} 상세 닫기`}
          className="rounded-sm border border-boundary-strong px-2 py-1 text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          닫기
        </button>
      </header>
      <section
        aria-label={`${item.title} 상세 내용`}
        className="max-h-80 overflow-y-auto"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the bounded detail scroller must be keyboard-reachable.
        tabIndex={0}
      >
        <ul className="grid gap-1 px-3 py-3 text-sm text-foreground">
          {item.detailLines.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
