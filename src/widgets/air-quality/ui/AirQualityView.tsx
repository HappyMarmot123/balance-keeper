import {
  AIR_QUALITY_REGIONS,
  type AirQualityGrade,
  type AirQualityRegionId,
  type AirQualitySnapshot,
  type AirQualitySummary,
  type airQualityDataSchema,
  selectAirQualitySummary,
} from '../../../entities/air-quality';
import { isAppError, type SuccessEnvelope } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

type AirQualityEnvelope = SuccessEnvelope<typeof airQualityDataSchema>;

export type AirQualityViewProps = Readonly<{
  data: AirQualityEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
  region: AirQualityRegionId;
}>;

const kstTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

const concentrationFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
});

const gradeLabels: Record<AirQualityGrade, string> = {
  bad: '나쁨',
  good: '좋음',
  moderate: '보통',
  'very-bad': '매우 나쁨',
};

const gradeClassNames: Record<AirQualityGrade, string> = {
  bad: 'border-warning bg-warning-soft text-warning',
  good: 'border-success bg-success-soft text-success',
  moderate: 'border-boundary-strong bg-surface-inset text-foreground',
  'very-bad': 'border-danger bg-danger-soft text-danger',
};

const createFreshness = (observedAt: number): PanelFreshness => ({
  dateTime: new Date(observedAt).toISOString(),
  label: `${kstTimeFormatter.format(observedAt)} 기준`,
});

type AirQualityDatumProps = Readonly<{
  label: string;
  summary: AirQualitySummary;
}>;

function AirQualityDatum({ label, summary }: AirQualityDatumProps) {
  const highest = summary.highest;

  return (
    <div className="min-w-0 border-l-2 border-accent bg-surface-raised px-3 py-3">
      <dt className="font-data text-xs font-semibold tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 break-words text-lg font-semibold tabular-nums">
        {highest === null ? '관측 없음' : `${concentrationFormatter.format(highest.concentration)} µg/m³`}
      </dd>
      <dd className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm">
        {highest === null ? (
          <span className="text-muted">등급 없음</span>
        ) : (
          <>
            <span
              className={`rounded-sm border px-2 py-1 font-data text-xs font-semibold ${gradeClassNames[highest.grade]}`}
            >
              {gradeLabels[highest.grade]}
            </span>
            <span className="min-w-0 break-words text-muted">
              <span>{highest.stationName}</span>
              <span> 측정소</span>
            </span>
          </>
        )}
      </dd>
      <dd className="mt-2 break-words font-data text-xs text-muted">
        관측 범위 {summary.observedStationCount}/{summary.totalStationCount} 측정소
      </dd>
    </div>
  );
}

function AirQualityMeasurements({ snapshot }: { snapshot: AirQualitySnapshot }) {
  const pm10Summary = selectAirQualitySummary(snapshot, 'pm10');
  const pm25Summary = selectAirQualitySummary(snapshot, 'pm25');
  const hasPartialCoverage = [pm10Summary, pm25Summary].some(
    (summary) => summary.observedStationCount < summary.totalStationCount,
  );

  return (
    <div className="grid gap-3">
      {hasPartialCoverage ? (
        <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-sm">
          일부 측정소의 관측값이 없어 관측 범위를 함께 표시합니다.
        </p>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-2">
        <AirQualityDatum label="PM10 미세먼지" summary={pm10Summary} />
        <AirQualityDatum label="PM2.5 초미세먼지" summary={pm25Summary} />
      </dl>
    </div>
  );
}

export function AirQualityView({ data, error, isPending, onRetry, region }: AirQualityViewProps) {
  const commonProps = {
    description: '한국환경공단 에어코리아 · 미확정 실시간 관측',
    source: 'AirKorea',
    title: `${AIR_QUALITY_REGIONS[region].name} 대기질`,
  } as const;

  if (data?.data) {
    const content = <AirQualityMeasurements snapshot={data.data} />;
    const freshness = createFreshness(data.data.observedAt);

    if (data.meta.cache === 'STALE') {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="게이트웨이가 마지막 성공 관측값을 제공하고 있습니다."
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
          message="새 관측값을 가져오지 못해 마지막 성공 관측값을 표시합니다."
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

  if (data?.data === null && error === null) {
    return <Panel {...commonProps} message="현재 제공할 수 있는 대기질 관측값이 없습니다." status="empty" />;
  }

  if (isAppError(error) && error.code === 'MISSING_CREDENTIALS') {
    return <Panel {...commonProps} status="missing-credential" />;
  }

  if (!isPending && error !== null) {
    return (
      <Panel
        {...commonProps}
        code={isAppError(error) ? error.code : undefined}
        message="대기질을 불러오지 못했습니다. 잠시 후 다시 시도하세요."
        onRetry={onRetry}
        status="error"
      />
    );
  }

  return <Panel {...commonProps} status="loading" />;
}
