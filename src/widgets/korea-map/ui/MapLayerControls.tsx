import { useEffect, useId, useRef, useState } from 'preact/hooks';

import { KOREA_MAP_LAYER_REGISTRY, type KoreaMapLayerId } from '../model/mapLayerRegistry';

export type MapLayerControlsProps = Readonly<{
  activeLayerIds: ReadonlySet<KoreaMapLayerId>;
  onReset: () => void;
  onToggle: (id: KoreaMapLayerId) => void;
}>;

export function MapLayerControls({ activeLayerIds, onReset, onToggle }: MapLayerControlsProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (rootRef.current?.contains(document.activeElement) !== true) {
        return;
      }
      setIsOpen(false);
      event.preventDefault();
      triggerRef.current?.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target) !== true) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [isOpen]);

  return (
    <div className="pointer-events-auto relative" ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-label={`지도 레이어, ${activeLayerIds.size}개 선택됨`}
        className="flex items-center gap-2 rounded-sm border border-boundary-strong bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span>지도 레이어</span>
        <span aria-hidden="true" className="rounded-sm bg-surface-inset px-1.5 py-0.5 font-data text-xs text-muted">
          {activeLayerIds.size}/{KOREA_MAP_LAYER_REGISTRY.length}
        </span>
      </button>

      {isOpen && (
        <fieldset
          className="absolute right-0 top-full z-20 mt-2 w-64 border border-boundary-strong bg-surface-raised p-2 shadow-lg"
          id={panelId}
        >
          <legend className="sr-only">지도 레이어 선택</legend>
          <div className="grid grid-cols-2 gap-1">
            {KOREA_MAP_LAYER_REGISTRY.map((layer) => {
              const isActive = activeLayerIds.has(layer.id);

              return (
                <button
                  aria-pressed={isActive}
                  className={
                    isActive
                      ? 'flex min-h-10 items-center gap-2 rounded-sm border border-accent bg-accent px-2 py-2 text-left text-xs font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                      : 'flex min-h-10 items-center gap-2 rounded-sm border border-boundary bg-surface-inset px-2 py-2 text-left text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                  }
                  key={layer.id}
                  onClick={() => onToggle(layer.id)}
                  type="button"
                >
                  <span aria-hidden="true" className="font-data text-xs">
                    {layer.symbol}
                  </span>
                  <span>{layer.label}</span>
                </button>
              );
            })}
          </div>
          <button
            className="mt-2 w-full rounded-sm border border-boundary-strong bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={onReset}
            type="button"
          >
            대한민국 전체 보기
          </button>
        </fieldset>
      )}
    </div>
  );
}
