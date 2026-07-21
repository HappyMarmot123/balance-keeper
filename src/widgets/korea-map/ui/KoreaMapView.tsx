import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { KoreaMapSession, NaverMapsNamespace } from '../../../entities/map';
import type { NaverMapsConfig } from '../../../shared/config';

export type KoreaMapServices = Readonly<{
  createSession(
    options: Readonly<{
      container: HTMLElement;
      maps: NaverMapsNamespace;
      styleId?: string;
    }>,
  ): KoreaMapSession;
  loadMaps(apiKeyId: string): Promise<NaverMapsNamespace>;
  subscribeAuthenticationFailure(listener: () => void): () => void;
}>;

export type KoreaMapViewProps = Readonly<{
  config: NaverMapsConfig;
  services: KoreaMapServices;
}>;

type MapFailure = 'authentication' | 'generic' | 'network' | 'timeout';

type MapViewState =
  | Readonly<{ kind: 'failed'; reason: MapFailure }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'missing-key' }>
  | Readonly<{ kind: 'ready-custom' }>
  | Readonly<{ kind: 'ready-default'; reason: 'custom-fallback' | 'style-not-configured' }>;

const safeFailureCopy: Record<MapFailure, string> = {
  authentication: '지도 인증을 확인할 수 없습니다. 등록된 서비스 주소와 지도 설정을 확인한 뒤 다시 시도하세요.',
  generic: '지도를 준비하지 못했습니다. 잠시 후 다시 시도하세요.',
  network: '지도 서비스를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요.',
  timeout: '지도 준비 시간이 초과되었습니다.',
};

function classifyFailure(error: unknown): MapFailure {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

  switch (code) {
    case 'AUTHENTICATION_FAILED':
      return 'authentication';
    case 'NETWORK_FAILED':
      return 'network';
    case 'INITIALIZATION_TIMEOUT':
    case 'LOAD_TIMEOUT':
    case 'RENDER_TIMEOUT':
      return 'timeout';
    default:
      return 'generic';
  }
}

function isRenderTimeout(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return code === 'INITIALIZATION_TIMEOUT' || code === 'RENDER_TIMEOUT';
}

function ArmillaryLoadingState() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" role="status">
      <div aria-hidden="true" className="absolute inset-x-4 top-1/2 h-px bg-boundary" />
      <div aria-hidden="true" className="absolute inset-y-4 left-1/2 w-px bg-boundary" />
      <div aria-hidden="true" className="absolute size-48 rounded-full border-2 border-boundary-strong" />
      <div aria-hidden="true" className="absolute size-36 rotate-45 rounded-full border border-accent" />
      <div aria-hidden="true" className="absolute size-24 -rotate-12 rounded-full border border-boundary-strong" />
      <div aria-hidden="true" className="absolute size-3 rounded-full border border-accent bg-surface-raised" />
      <p className="absolute top-4 border-l-2 border-accent bg-surface-raised px-3 py-2 font-data text-xs text-foreground">
        대한민국 지도 화면을 준비하고 있습니다.
      </p>
    </div>
  );
}

function MissingConfigurationState() {
  return (
    <div className="absolute inset-0 z-10 grid place-content-center bg-surface-inset px-6 text-center" role="status">
      <p className="mx-auto max-w-xl text-sm leading-6 text-muted">
        대한민국 지도를 표시하려면 지도 연결 설정이 필요합니다. 관리자에게 문의하세요.
      </p>
    </div>
  );
}

function FailureState({ onRetry, reason }: Readonly<{ onRetry: () => void; reason: MapFailure }>) {
  return (
    <div
      className="absolute inset-0 z-10 grid place-content-center gap-4 bg-surface-inset px-6 text-center"
      role="alert"
    >
      <p className="mx-auto max-w-xl text-sm leading-6 text-muted">{safeFailureCopy[reason]}</p>
      <button
        className="mx-auto w-fit rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onClick={onRetry}
        type="button"
      >
        다시 시도
      </button>
    </div>
  );
}

function ReadyControls({
  defaultReason,
  isCustom,
  onReset,
}: Readonly<{
  defaultReason?: 'custom-fallback' | 'style-not-configured';
  isCustom: boolean;
  onReset: () => void;
}>) {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex flex-wrap items-start justify-between gap-3">
      <div className="border-l-2 border-accent bg-surface-raised px-3 py-2" role="status">
        <p className="font-data text-xs font-semibold text-foreground">
          {isCustom ? 'NAVER GL · 다크 맞춤 스타일' : 'NAVER GL · 기본 스타일'}
        </p>
        {!isCustom && (
          <p className="mt-1 max-w-md text-xs leading-5 text-muted">
            {defaultReason === 'custom-fallback'
              ? '맞춤 지도 스타일을 불러오지 못해 기본 지도로 전환했습니다.'
              : '맞춤 지도 스타일이 설정되지 않아 기본 지도를 표시합니다.'}
          </p>
        )}
      </div>
      <button
        className="pointer-events-auto rounded-sm border border-boundary-strong bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onClick={onReset}
        type="button"
      >
        대한민국 전체 보기
      </button>
    </div>
  );
}

export function KoreaMapView({ config, services }: KoreaMapViewProps) {
  const titleId = useId();
  const mapRootRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<KoreaMapSession>();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MapViewState>(() =>
    config.kind === 'missing-key' ? { kind: 'missing-key' } : { kind: 'loading' },
  );
  const apiKeyId = config.kind === 'ready' ? config.apiKeyId : undefined;
  const styleId = config.kind === 'ready' ? config.styleId : undefined;

  useEffect(() => {
    if (!apiKeyId) {
      setState({ kind: 'missing-key' });
      return;
    }

    const container = mapRootRef.current;
    if (!container) {
      return;
    }

    let active = true;
    let authenticationFailed = false;
    let ownedSession: KoreaMapSession | undefined;
    let unsubscribeAuthenticationFailure: (() => void) | undefined;
    setState({ kind: 'loading' });

    void services.loadMaps(apiKeyId).then(
      (maps) => {
        if (!active) {
          return;
        }

        try {
          unsubscribeAuthenticationFailure = services.subscribeAuthenticationFailure(() => {
            if (!active) {
              return;
            }
            authenticationFailed = true;
            ownedSession?.destroy();
            setState({ kind: 'failed', reason: 'authentication' });
          });
        } catch (error) {
          setState({ kind: 'failed', reason: classifyFailure(error) });
          return;
        }

        const beginSession = (
          requestedStyleId: string | undefined,
          readyState: 'custom-fallback' | 'custom-style' | 'default-style',
        ): void => {
          let createdSession: KoreaMapSession;
          try {
            createdSession = services.createSession({
              container,
              maps,
              ...(requestedStyleId ? { styleId: requestedStyleId } : {}),
            });
          } catch (error) {
            if (active) {
              setState({ kind: 'failed', reason: classifyFailure(error) });
            }
            return;
          }

          if (authenticationFailed || !active) {
            createdSession.destroy();
            return;
          }
          ownedSession = createdSession;
          sessionRef.current = createdSession;

          void createdSession.ready.then(
            () => {
              if (!active || authenticationFailed || ownedSession !== createdSession) {
                return;
              }
              setState(
                readyState === 'custom-style'
                  ? { kind: 'ready-custom' }
                  : {
                      kind: 'ready-default',
                      reason: readyState === 'custom-fallback' ? 'custom-fallback' : 'style-not-configured',
                    },
              );
            },
            (error) => {
              if (!active || authenticationFailed || ownedSession !== createdSession) {
                return;
              }
              createdSession.destroy();
              ownedSession = undefined;
              if (sessionRef.current === createdSession) {
                sessionRef.current = undefined;
              }

              if (requestedStyleId && isRenderTimeout(error)) {
                beginSession(undefined, 'custom-fallback');
                return;
              }
              setState({ kind: 'failed', reason: classifyFailure(error) });
            },
          );
        };

        beginSession(styleId, styleId ? 'custom-style' : 'default-style');
      },
      (error) => {
        if (active) {
          setState({ kind: 'failed', reason: classifyFailure(error) });
        }
      },
    );

    return () => {
      active = false;
      unsubscribeAuthenticationFailure?.();
      ownedSession?.destroy();
      if (sessionRef.current === ownedSession) {
        sessionRef.current = undefined;
      }
    };
  }, [apiKeyId, attempt, services, styleId]);

  return (
    <section
      aria-busy={state.kind === 'loading' ? 'true' : undefined}
      aria-labelledby={titleId}
      className="relative isolate min-h-160 min-w-0 overflow-hidden border border-boundary bg-surface-inset lg:min-h-192"
    >
      <h2 className="sr-only" id={titleId}>
        대한민국 상황 지도
      </h2>
      <div className="absolute inset-0 z-0 h-full w-full" data-naver-map-root="" ref={mapRootRef} />

      {state.kind === 'loading' && <ArmillaryLoadingState />}
      {state.kind === 'missing-key' && <MissingConfigurationState />}
      {state.kind === 'failed' && (
        <FailureState onRetry={() => setAttempt((current) => current + 1)} reason={state.reason} />
      )}
      {state.kind === 'ready-custom' && (
        <ReadyControls isCustom={true} onReset={() => sessionRef.current?.resetView()} />
      )}
      {state.kind === 'ready-default' && (
        <ReadyControls defaultReason={state.reason} isCustom={false} onReset={() => sessionRef.current?.resetView()} />
      )}
    </section>
  );
}
