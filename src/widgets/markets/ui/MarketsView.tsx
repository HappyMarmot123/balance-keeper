import type { MarketIndex, MarketSnapshot, marketDataSchema } from '../../../entities/market';
import { isAppError, type SuccessEnvelope } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

type MarketsEnvelope = SuccessEnvelope<typeof marketDataSchema>;

export type MarketsViewProps = Readonly<{
  data: MarketsEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
}>;

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
  year: 'numeric',
});

const valueFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const createFreshness = (fetchedAt: number): PanelFreshness => {
  const parts = Object.fromEntries(timeFormatter.formatToParts(fetchedAt).map((part) => [part.type, part.value]));
  return {
    dateTime: new Date(fetchedAt).toISOString(),
    label: `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute} 수집`,
  };
};

const formatDate = (date: string): string => `${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)} 최근 거래일`;

const changeTone = (change: number): string =>
  change > 0 ? 'text-success' : change < 0 ? 'text-danger' : 'text-muted';

const formatChange = (observation: NonNullable<MarketIndex['observation']>): string => {
  if (observation.change > 0) {
    return `상승 ${valueFormatter.format(observation.change)} (+${valueFormatter.format(observation.changePercent)}%)`;
  }
  if (observation.change < 0) {
    return `하락 ${valueFormatter.format(Math.abs(observation.change))} (${valueFormatter.format(
      observation.changePercent,
    )}%)`;
  }
  return `보합 ${valueFormatter.format(0)} (${valueFormatter.format(observation.changePercent)}%)`;
};

function MarketIndexCard({ index }: { index: MarketIndex }) {
  return (
    <li className="grid min-w-0 gap-2 border-l-2 border-accent bg-surface-raised px-3 py-3">
      <p className="text-sm font-semibold">{index.label}</p>
      {index.status === 'available' && index.observation !== null ? (
        <>
          <p className="font-data text-xl font-semibold tabular-nums">
            {valueFormatter.format(index.observation.close)} {index.displayUnit}
          </p>
          <p className={`font-data text-sm font-semibold tabular-nums ${changeTone(index.observation.change)}`}>
            {formatChange(index.observation)}
          </p>
          <p className="font-data text-xs text-muted">{formatDate(index.observation.date)}</p>
        </>
      ) : (
        <p className="text-sm text-muted">{index.status === 'empty' ? '자료 없음' : '일시적으로 확인 불가'}</p>
      )}
    </li>
  );
}

function MarketsContent({ snapshot }: { snapshot: MarketSnapshot }) {
  const hasUnavailable = snapshot.indices.some((index) => index.status === 'unavailable');

  return (
    <div className="grid min-w-0 gap-3">
      {hasUnavailable ? (
        <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-sm" role="status">
          일부 국내 지수를 가져오지 못했습니다. 사용 가능한 종가만 표시합니다.
        </p>
      ) : null}
      <ul aria-label="국내 주가지수 최근 종가" className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {snapshot.indices.map((index) => (
          <MarketIndexCard index={index} key={index.id} />
        ))}
      </ul>
      <p className="font-data text-xs text-muted">
        금융위원회 · 한국거래소 통계정보 · 다음 영업일 13시 이후 · 하루 지연
      </p>
    </div>
  );
}

export function MarketsView({ data, error, isPending, onRetry }: MarketsViewProps) {
  const commonProps = {
    description: 'KOSPI · KOSDAQ 최근 종가',
    source: data?.meta.source ?? '금융위원회',
    title: '국내 주가지수',
  } as const;

  if (data !== undefined) {
    const allEmpty = data.data.indices.every((index) => index.status === 'empty');
    if (allEmpty && error === null && data.meta.cache !== 'STALE') {
      return <Panel {...commonProps} message="최근 조회 범위에 제공된 국내 지수 자료가 없습니다." status="empty" />;
    }

    const content = <MarketsContent snapshot={data.data} />;
    const freshness = createFreshness(data.meta.fetchedAt);
    if (data.meta.cache === 'STALE') {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="게이트웨이가 마지막 성공 국내 지수 정보를 제공하고 있습니다."
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
          message="새 정보를 가져오지 못해 마지막 성공 국내 지수 정보를 표시합니다."
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
    if (isAppError(error) && error.code === 'MISSING_CREDENTIALS') {
      return <Panel {...commonProps} status="missing-credential" />;
    }
    return (
      <Panel
        {...commonProps}
        code={isAppError(error) ? error.code : undefined}
        message="국내 지수 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
        onRetry={onRetry}
        status="error"
      />
    );
  }

  return <Panel {...commonProps} status="loading" />;
}
