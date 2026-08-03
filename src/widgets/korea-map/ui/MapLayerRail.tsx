import { useEffect, useRef } from 'preact/hooks';

import type { KoreaMapLayerId } from '../model/mapLayerRegistry';
import { type MapLayerSelection, mapLayerRuntimeStatus, type ResolvedMapLayerRuntime } from '../model/mapLayerRuntime';
import type { MapLayerRejectionReason } from './MapLayerOverlay';

const freshnessFormatter = new Intl.DateTimeFormat('ko-KR', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
});

type MapLayerRailProps = Readonly<{
  activeRuntimes: readonly ResolvedMapLayerRuntime[];
  onFocusRestored: () => void;
  onRailLayerChange: (id: KoreaMapLayerId) => void;
  onRetrySessionLayer: (id: KoreaMapLayerId) => void;
  onSelect: (layerId: KoreaMapLayerId, itemId: string) => void;
  railRuntime: ResolvedMapLayerRuntime;
  restoreFocusKey?: string;
  selection?: MapLayerSelection;
  sessionRejections: ReadonlyMap<KoreaMapLayerId, MapLayerRejectionReason>;
}>;

export function MapLayerRail({
  activeRuntimes,
  onFocusRestored,
  onRailLayerChange,
  onRetrySessionLayer,
  onSelect,
  railRuntime,
  restoreFocusKey,
  selection,
  sessionRejections,
}: MapLayerRailProps) {
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selection !== undefined || restoreFocusKey === undefined) {
      return;
    }

    const priorTrigger = itemButtonRefs.current.get(restoreFocusKey);
    if (priorTrigger === undefined || !priorTrigger.isConnected) {
      railRef.current?.focus();
    } else {
      priorTrigger.focus();
    }
    onFocusRestored();
  }, [onFocusRestored, restoreFocusKey, selection]);

  const secondaryFailures = activeRuntimes.filter(
    (runtime) =>
      runtime.id !== railRuntime.id &&
      (runtime.phase === 'error' || runtime.phase === 'missing-config' || sessionRejections.has(runtime.id)),
  );

  return (
    <aside
      aria-busy={railRuntime.phase === 'loading' ? 'true' : undefined}
      aria-label="지도 데이터 목록"
      className={
        selection === undefined
          ? 'absolute left-4 right-16 top-44 z-10 max-h-96 overflow-y-auto border border-boundary bg-surface-raised lg:right-auto lg:top-24 lg:w-80'
          : 'absolute left-4 right-16 top-44 z-10 hidden max-h-96 overflow-y-auto border border-boundary bg-surface-raised lg:right-auto lg:top-24 lg:block lg:w-80'
      }
      ref={railRef}
      tabIndex={-1}
    >
      <header className="border-b border-boundary px-3 py-2">
        {activeRuntimes.length > 1 ? (
          <label className="grid gap-1 text-xs font-semibold text-foreground">
            목록 레이어
            <select
              aria-label="목록 레이어"
              className="min-h-10 border border-boundary-strong bg-surface-inset px-2 py-1 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onChange={(event) => onRailLayerChange(event.currentTarget.value as KoreaMapLayerId)}
              value={railRuntime.id}
            >
              {activeRuntimes.map((runtime) => (
                <option key={runtime.id} value={runtime.id}>
                  {runtime.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="font-data text-xs font-semibold text-foreground">{railRuntime.label}</p>
        )}
        {railRuntime.phase !== 'error' && railRuntime.phase !== 'missing-config' && (
          <div aria-live="polite" className="mt-2 text-xs text-muted" role="status">
            <p>
              {sessionRejections.has(railRuntime.id)
                ? '지도 표시를 갱신하지 못해 마지막 결과를 유지합니다.'
                : mapLayerRuntimeStatus(railRuntime)}
            </p>
            {(railRuntime.stale || railRuntime.partial) && (
              <div className="mt-1 text-warning">
                {railRuntime.partial && <p>일부 소스만 표시합니다.</p>}
                {railRuntime.stale && <p>마지막으로 확인된 결과입니다.</p>}
              </div>
            )}
          </div>
        )}
        {railRuntime.fetchedAt !== undefined && railRuntime.source !== undefined && (
          <time
            className="mt-1 block font-data text-xs text-muted"
            dateTime={new Date(railRuntime.fetchedAt).toISOString()}
          >
            {railRuntime.source} · {freshnessFormatter.format(railRuntime.fetchedAt)} 수집
          </time>
        )}
      </header>

      {sessionRejections.has(railRuntime.id) && (
        <div className="border-b border-boundary px-3 py-2">
          <button
            className="rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => onRetrySessionLayer(railRuntime.id)}
            type="button"
          >
            {railRuntime.label} 지도 다시 시도
          </button>
        </div>
      )}

      {secondaryFailures.length > 0 && (
        <div className="border-b border-boundary bg-danger-soft px-3 py-2" role="alert">
          {secondaryFailures.map((runtime) => (
            <div className="flex items-center justify-between gap-2" key={runtime.id}>
              <p className="text-xs text-danger">
                {sessionRejections.has(runtime.id)
                  ? `${runtime.label} 지도 표시를 갱신하지 못했습니다.`
                  : mapLayerRuntimeStatus(runtime)}
              </p>
              {runtime.phase !== 'missing-config' && (
                <button
                  className="shrink-0 rounded-sm border border-danger px-2 py-1 text-xs font-semibold text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  onClick={sessionRejections.has(runtime.id) ? () => onRetrySessionLayer(runtime.id) : runtime.retry}
                  type="button"
                >
                  {sessionRejections.has(runtime.id) ? `${runtime.label} 지도 다시 시도` : '다시 시도'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {(railRuntime.phase === 'error' || railRuntime.phase === 'missing-config') && (
        <div className="grid gap-2 px-3 py-3">
          <p className="text-sm text-foreground" role={railRuntime.phase === 'error' ? 'alert' : 'status'}>
            {mapLayerRuntimeStatus(railRuntime)}
          </p>
          {railRuntime.phase === 'error' && (
            <button
              className="w-fit rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={railRuntime.retry}
              type="button"
            >
              {railRuntime.label} 다시 시도
            </button>
          )}
        </div>
      )}

      {railRuntime.overlayItems.length > 0 && (
        <ul className="p-2">
          {railRuntime.overlayItems.map((item) => {
            const key = `${railRuntime.id}:${item.id}`;
            const isSelected = selection?.layerId === railRuntime.id && selection.itemId === item.id;
            return (
              <li key={item.id}>
                <button
                  aria-label={item.accessibleName}
                  aria-pressed={isSelected}
                  className={
                    isSelected
                      ? 'w-full border-b border-l-2 border-boundary border-l-accent bg-surface-inset px-2 py-2 text-left text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                      : 'w-full border-b border-boundary px-2 py-2 text-left text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                  }
                  onClick={() => onSelect(railRuntime.id, item.id)}
                  ref={(element) => {
                    if (element === null) {
                      itemButtonRefs.current.delete(key);
                    } else {
                      itemButtonRefs.current.set(key, element);
                    }
                  }}
                  type="button"
                >
                  <span className="block break-words font-semibold">{item.title}</span>
                  <span className="mt-1 block text-xs text-muted">{item.detailLines[0]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
