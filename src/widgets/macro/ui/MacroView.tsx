import type { MacroSeries, MacroSnapshot, macroDataSchema } from '../../../entities/macro';
import { isAppError, type SuccessEnvelope } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

type MacroEnvelope = SuccessEnvelope<typeof macroDataSchema>;

export type MacroViewProps = Readonly<{
  data: MacroEnvelope | undefined;
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

const valueFormatters = Object.freeze({
  'base-rate': new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }),
  'fx-reserves': new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }),
  'usd-krw': new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }),
});

const createFreshness = (fetchedAt: number): PanelFreshness => {
  const parts = Object.fromEntries(timeFormatter.formatToParts(fetchedAt).map((part) => [part.type, part.value]));
  return {
    dateTime: new Date(fetchedAt).toISOString(),
    label: `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute} 수집`,
  };
};

const formatPeriod = (period: string, cycle: MacroSeries['cycle']): string =>
  cycle === 'D'
    ? `${period.slice(0, 4)}.${period.slice(4, 6)}.${period.slice(6, 8)}`
    : `${period.slice(0, 4)}.${period.slice(4, 6)}`;

function MacroSeriesCard({ series }: { series: MacroSeries }) {
  return (
    <li className="grid min-w-0 gap-2 border-l-2 border-accent bg-surface-raised px-3 py-3">
      <p className="text-sm font-semibold">{series.label}</p>
      {series.status === 'available' && series.observation !== null ? (
        <>
          <p className="font-data text-xl font-semibold tabular-nums">
            {valueFormatters[series.id].format(series.observation.value)} {series.displayUnit}
          </p>
          <p className="font-data text-xs text-muted">{formatPeriod(series.observation.period, series.cycle)} 기준</p>
        </>
      ) : (
        <p className="text-sm text-muted">{series.status === 'empty' ? '자료 없음' : '일시적으로 확인 불가'}</p>
      )}
    </li>
  );
}

function MacroContent({ snapshot }: { snapshot: MacroSnapshot }) {
  const hasUnavailable = snapshot.series.some((series) => series.status === 'unavailable');

  return (
    <div className="grid min-w-0 gap-3">
      {hasUnavailable ? (
        <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-sm" role="status">
          일부 ECOS 지표를 가져오지 못했습니다. 사용 가능한 지표만 표시합니다.
        </p>
      ) : null}
      <ul aria-label="핵심 거시경제 지표" className="grid min-w-0 gap-2">
        {snapshot.series.map((series) => (
          <MacroSeriesCard key={series.id} series={series} />
        ))}
      </ul>
      <p className="font-data text-xs text-muted">한국은행 ECOS · 일별 환율/기준금리 · 월별 외환보유액</p>
    </div>
  );
}

export function MacroView({ data, error, isPending, onRetry }: MacroViewProps) {
  const commonProps = {
    description: '환율 · 기준금리 · 외환보유액',
    source: data?.meta.source ?? 'ECOS',
    title: '한국 거시경제',
  } as const;

  if (data !== undefined) {
    const allEmpty = data.data.series.every((series) => series.status === 'empty');
    if (allEmpty && error === null && data.meta.cache !== 'STALE') {
      return <Panel {...commonProps} message="현재 조회 범위에 제공된 거시경제 자료가 없습니다." status="empty" />;
    }

    const content = <MacroContent snapshot={data.data} />;
    const freshness = createFreshness(data.meta.fetchedAt);
    if (data.meta.cache === 'STALE') {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="게이트웨이가 마지막 성공 거시경제 정보를 제공하고 있습니다."
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
          message="새 정보를 가져오지 못해 마지막 성공 거시경제 정보를 표시합니다."
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
        message="거시경제 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
        onRetry={onRetry}
        status="error"
      />
    );
  }

  return <Panel {...commonProps} status="loading" />;
}
