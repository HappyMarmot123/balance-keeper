import type { NewsItem, NewsSnapshot, newsDataSchema } from '../../../entities/news';
import { isAppError, type SuccessEnvelope } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

type NewsEnvelope = SuccessEnvelope<typeof newsDataSchema>;

export type NewsViewProps = Readonly<{
  data: NewsEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
}>;

const collectedTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
  year: 'numeric',
});

const publishedTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
});

const formatParts = (formatter: Intl.DateTimeFormat, epochMs: number) =>
  Object.fromEntries(formatter.formatToParts(epochMs).map((part) => [part.type, part.value]));

const createFreshness = (fetchedAt: number): PanelFreshness => {
  const parts = formatParts(collectedTimeFormatter, fetchedAt);

  return {
    dateTime: new Date(fetchedAt).toISOString(),
    label: `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute} 수집`,
  };
};

const formatPublishedAt = (publishedAt: number): string => {
  const parts = formatParts(publishedTimeFormatter, publishedAt);

  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
};

function NewsItemRow({ item, snapshot }: { item: NewsItem; snapshot: NewsSnapshot }) {
  const source = snapshot.sources.find((candidate) => candidate.id === item.sourceId);

  return (
    <li className="grid min-w-0 gap-2 border-l-2 border-accent bg-surface-raised px-3 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-data text-xs text-muted">
        <span className="min-w-0 break-words font-semibold text-foreground">{source?.label ?? item.sourceId}</span>
        <time dateTime={new Date(item.publishedAt).toISOString()}>{formatPublishedAt(item.publishedAt)}</time>
      </div>
      <a
        className="min-w-0 break-words text-sm font-semibold text-accent underline decoration-boundary-strong underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        href={item.originalUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        {item.title}
        <span className="sr-only"> (원문 새 창)</span>
      </a>
    </li>
  );
}

function NewsContent({ snapshot }: { snapshot: NewsSnapshot }) {
  const unavailableSources = snapshot.sources.filter((source) => source.status === 'unavailable');

  return (
    <div className="grid min-w-0 gap-3">
      {unavailableSources.length > 0 ? (
        <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-sm" role="status">
          일부 기관 보도자료를 가져오지 못했습니다. 사용 가능한 보도자료만 표시합니다.
          <span className="mt-1 block font-data text-xs text-muted">
            확인 불가: {unavailableSources.map((source) => source.label).join(' · ')}
          </span>
        </p>
      ) : null}

      {snapshot.items.length === 0 ? (
        <p className="text-sm text-muted">현재 사용 가능한 기관에 표시할 보도자료가 없습니다.</p>
      ) : (
        <ol aria-label="최신 공공 정책 보도자료" className="grid min-w-0 gap-2">
          {snapshot.items.map((item) => (
            <NewsItemRow item={item} key={item.id} snapshot={snapshot} />
          ))}
        </ol>
      )}

      <p className="font-data text-xs text-muted">공공누리 제1유형 · 출처 표시 · 제목과 원문 링크만 제공</p>
    </div>
  );
}

export function NewsView({ data, error, isPending, onRetry }: NewsViewProps) {
  const commonProps = {
    description: '문화체육관광부 · 행정안전부 공식 보도자료',
    source: data?.meta.source.replaceAll('+', ' · ') ?? 'MCST · MOIS',
    title: '공공 정책 보도자료',
  } as const;

  if (data !== undefined) {
    const allSourcesEmpty = data.data.sources.every((source) => source.status === 'empty');
    if (data.data.items.length === 0 && allSourcesEmpty && error === null && data.meta.cache !== 'STALE') {
      return <Panel {...commonProps} message="현재 제공된 공공 보도자료가 없습니다." status="empty" />;
    }

    const content = <NewsContent snapshot={data.data} />;
    const freshness = createFreshness(data.meta.fetchedAt);

    if (data.meta.cache === 'STALE') {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="게이트웨이가 마지막 성공 보도자료를 제공하고 있습니다."
          status="stale"
        >
          {content}
        </Panel>
      );
    }

    if (error !== null) {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="새 보도자료를 가져오지 못해 마지막 성공 보도자료를 표시합니다."
          status="stale"
        >
          {content}
        </Panel>
      );
    }

    return (
      <Panel {...commonProps} freshness={freshness} status="success">
        {content}
      </Panel>
    );
  }

  if (!isPending && error !== null) {
    return (
      <Panel
        {...commonProps}
        code={isAppError(error) ? error.code : undefined}
        message="공공 보도자료를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
        onRetry={onRetry}
        status="error"
      />
    );
  }

  return <Panel {...commonProps} status="loading" />;
}
