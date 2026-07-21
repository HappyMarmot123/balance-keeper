import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

export type PanelStatus = 'loading' | 'error' | 'empty' | 'stale' | 'success' | 'disabled' | 'missing-credential';

export type PanelFreshness = {
  dateTime: string;
  label: string;
};

type PanelAction = {
  label: string;
  onSelect: () => void;
};

type PanelBaseProps = {
  description?: string;
  headingLevel?: 2 | 3;
  source?: string;
  title: string;
};

type PanelStateProps =
  | { status: 'loading'; message?: string }
  | { status: 'error'; announce?: boolean; code?: string; message: string; onRetry?: () => void }
  | { status: 'empty'; action?: PanelAction; message: string }
  | {
      status: 'stale';
      children: ComponentChildren;
      freshness: PanelFreshness;
      message: string;
    }
  | { status: 'success'; children: ComponentChildren; freshness: PanelFreshness }
  | { status: 'disabled'; message: string }
  | { status: 'missing-credential' };

export type PanelProps = PanelBaseProps & PanelStateProps;

export function Panel(props: PanelProps) {
  const titleId = useId();
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2';

  return (
    <section
      aria-busy={props.status === 'loading' ? 'true' : undefined}
      aria-disabled={props.status === 'disabled' ? 'true' : undefined}
      aria-labelledby={titleId}
      className="min-h-48 min-w-0 rounded-sm border border-boundary bg-surface text-foreground"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-boundary px-4 py-3">
        <div className="min-w-0">
          <Heading className="break-words font-data text-sm font-semibold tracking-wide" id={titleId}>
            {props.title}
          </Heading>
          {props.description ? <p className="mt-1 break-words text-sm text-muted">{props.description}</p> : null}
        </div>

        {props.source || props.status === 'success' || props.status === 'stale' ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-accent pl-3 font-data text-xs text-muted">
            {props.source ? (
              <span className="min-w-0 break-all">
                <span className="sr-only">출처 </span>
                {props.source}
              </span>
            ) : null}
            {props.status === 'success' || props.status === 'stale' ? (
              <time className="min-w-0 break-words" dateTime={props.freshness.dateTime}>
                {props.freshness.label}
              </time>
            ) : null}
          </div>
        ) : null}
      </div>

      {props.status === 'loading' ? (
        <div className="grid min-h-32 place-content-center gap-3 px-4 py-6 text-center" role="status">
          <span
            aria-hidden="true"
            className="mx-auto size-8 animate-pulse rounded-full border border-boundary-strong bg-surface-inset motion-reduce:animate-none"
          />
          <p className="break-words text-sm text-muted">{props.message ?? '데이터를 불러오는 중입니다.'}</p>
        </div>
      ) : null}

      {props.status === 'stale' ? (
        <div className="flex items-start gap-2 border-b border-warning bg-warning-soft px-4 py-3 text-sm" role="status">
          <span aria-hidden="true" className="font-data text-xs font-bold text-warning">
            STALE
          </span>
          <span className="min-w-0 break-words">{props.message}</span>
        </div>
      ) : null}

      {props.status === 'error' ? (
        <div
          className="grid min-h-32 content-center gap-3 bg-danger-soft px-4 py-6"
          role={props.announce === false ? undefined : 'alert'}
        >
          <p className="break-words text-sm">{props.message}</p>
          {props.code ? <code className="break-all font-data text-xs text-danger">{props.code}</code> : null}
          {props.onRetry ? (
            <button
              className="w-fit rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={props.onRetry}
              type="button"
            >
              다시 시도
            </button>
          ) : null}
        </div>
      ) : null}

      {props.status === 'empty' ? (
        <div className="grid min-h-32 content-center justify-items-start gap-3 px-4 py-6">
          <p className="break-words text-sm text-muted">{props.message}</p>
          {props.action ? (
            <button
              className="rounded-sm border border-boundary-strong bg-surface-raised px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={props.action.onSelect}
              type="button"
            >
              {props.action.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {props.status === 'disabled' ? (
        <div className="grid min-h-32 place-content-center bg-surface-inset px-4 py-6 text-center">
          <p className="break-words text-sm text-muted">{props.message}</p>
        </div>
      ) : null}

      {props.status === 'missing-credential' ? (
        <div className="grid min-h-32 content-center gap-2 bg-warning-soft px-4 py-6" role="status">
          <span aria-hidden="true" className="font-data text-xs font-bold text-warning">
            SETUP
          </span>
          <p className="break-words text-sm">연결 설정이 필요합니다. 관리자에게 문의하세요.</p>
        </div>
      ) : null}

      {props.status === 'success' || props.status === 'stale' ? (
        <div className="min-w-0 break-words px-4 py-4">{props.children}</div>
      ) : null}
    </section>
  );
}
