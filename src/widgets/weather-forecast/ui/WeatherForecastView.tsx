import {
  WEATHER_REGIONS,
  type WeatherForecastEnvelope,
  type WeatherForecastPeriod,
  type WeatherForecastPrecipitationAmount,
  type WeatherForecastPrecipitationType,
  type WeatherForecastSkyCondition,
  type WeatherRegionId,
} from '../../../entities/weather';
import { isAppError } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

export type WeatherForecastViewProps = Readonly<{
  data: WeatherForecastEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  now?: number;
  onRetry: () => void;
  region: WeatherRegionId;
}>;

const issueTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

const periodTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
});

const measurementFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
});

const skyLabels: Record<WeatherForecastSkyCondition, string> = {
  clear: '맑음',
  'mostly-cloudy': '구름 많음',
  overcast: '흐림',
};

const precipitationTypeLabels: Record<WeatherForecastPrecipitationType, string> = {
  none: '강수 없음',
  rain: '비',
  'rain-snow': '비 또는 눈',
  snow: '눈',
  shower: '소나기',
};

const createFreshness = (issuedAt: number): PanelFreshness => ({
  dateTime: new Date(issuedAt).toISOString(),
  label: `${issueTimeFormatter.format(issuedAt)} 발표`,
});

const formatPeriodTime = (epochMs: number): string => {
  const parts = Object.fromEntries(periodTimeFormatter.formatToParts(epochMs).map((part) => [part.type, part.value]));
  return `${Number(parts.month)}월 ${Number(parts.day)}일 ${parts.hour}시`;
};

const formatTemperature = (temperature: number | null): string =>
  temperature === null ? '기온 없음' : `${measurementFormatter.format(temperature)} °C`;

const formatPrecipitationAmount = (amount: WeatherForecastPrecipitationAmount | null): string => {
  if (amount === null) {
    return '강수량 없음';
  }
  switch (amount.kind) {
    case 'none':
      return '강수 없음';
    case 'less-than':
      return `${measurementFormatter.format(amount.millimeters)} mm 미만`;
    case 'amount':
      return `${measurementFormatter.format(amount.millimeters)} mm`;
    case 'range':
      return `${measurementFormatter.format(amount.minimumMillimeters)}–${measurementFormatter.format(
        amount.maximumMillimeters,
      )} mm`;
    case 'at-least':
      return `${measurementFormatter.format(amount.millimeters)} mm 이상`;
  }
};

const formatPrecipitation = (period: Extract<WeatherForecastPeriod, { availability: 'available' }>): string => {
  const probability =
    period.precipitationProbabilityPercent === null
      ? '확률 없음'
      : `강수 ${measurementFormatter.format(period.precipitationProbabilityPercent)}%`;
  const type =
    period.precipitationType === null
      ? formatPrecipitationAmount(period.precipitationAmount)
      : precipitationTypeLabels[period.precipitationType];

  return `${probability} · ${type}`;
};

function ForecastPeriod({ period }: { period: WeatherForecastPeriod }) {
  const label = formatPeriodTime(period.forecastAt);

  return (
    <li className="grid min-w-0 content-start gap-2 border-l-2 border-accent bg-surface-raised px-3 py-3">
      <time
        className="font-data text-xs font-semibold tabular-nums text-muted"
        dateTime={new Date(period.forecastAt).toISOString()}
      >
        {label}
      </time>
      {period.availability === 'unavailable' ? (
        <p className="text-sm font-semibold text-muted">예보 없음</p>
      ) : (
        <>
          <p className="font-data text-lg font-semibold tabular-nums">{formatTemperature(period.temperatureCelsius)}</p>
          <p className="text-sm font-semibold">
            {period.skyCondition === null ? '하늘 상태 없음' : skyLabels[period.skyCondition]}
          </p>
          <p className="font-data text-xs text-muted">{formatPrecipitation(period)}</p>
        </>
      )}
    </li>
  );
}

const isPeriodPartial = (period: WeatherForecastPeriod): boolean =>
  period.availability === 'unavailable' ||
  period.temperatureCelsius === null ||
  period.skyCondition === null ||
  period.precipitationAmount === null ||
  period.precipitationProbabilityPercent === null ||
  period.precipitationType === null;

function ForecastPeriods({
  label,
  now,
  periods,
}: {
  label: string;
  now: number;
  periods: readonly WeatherForecastPeriod[];
}) {
  const visiblePeriods = periods.filter((period) => period.forecastAt >= now).slice(0, 6);
  const isPartial = visiblePeriods.length > 0 && (visiblePeriods.length < 6 || visiblePeriods.some(isPeriodPartial));

  return (
    <div className="grid min-w-0 gap-3">
      {isPartial ? (
        <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-sm" role="status">
          일부 시간대 자료 없음
        </p>
      ) : null}
      {visiblePeriods.length === 0 ? (
        <p className="text-sm text-muted" role="status">
          현재 이후 제공할 시간별 예보가 없습니다.
        </p>
      ) : (
        <ol aria-label={label} className="grid min-w-0 grid-cols-2 gap-2 2xl:grid-cols-3">
          {visiblePeriods.map((period) => (
            <ForecastPeriod key={period.forecastAt} period={period} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function WeatherForecastView({
  data,
  error,
  isPending,
  now = Date.now(),
  onRetry,
  region,
}: WeatherForecastViewProps) {
  const title = `${WEATHER_REGIONS[region].name} 시간별 예보`;
  const commonProps = {
    description: '기상청 단기예보 · 가까운 6시간',
    source: 'KMA',
    title,
  } as const;

  if (data?.data) {
    const content = <ForecastPeriods label={title} now={now} periods={data.data.periods} />;
    const freshness = createFreshness(data.data.issuedAt);

    if (data.meta.cache === 'STALE') {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="게이트웨이가 마지막 성공 예보를 제공하고 있습니다."
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
          message="새 예보를 가져오지 못해 마지막 성공 예보를 표시합니다."
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
    return <Panel {...commonProps} message="현재 제공할 시간별 예보가 없습니다." status="empty" />;
  }

  if (isPending || error === null) {
    return <Panel {...commonProps} status="loading" />;
  }

  if (isAppError(error) && error.code === 'MISSING_CREDENTIALS') {
    return <Panel {...commonProps} status="missing-credential" />;
  }

  return (
    <Panel
      {...commonProps}
      code={isAppError(error) ? error.code : undefined}
      message="시간별 예보를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
      onRetry={onRetry}
      status="error"
    />
  );
}
