import {
  WEATHER_REGIONS,
  type WeatherNowcast,
  type WeatherNowcastEnvelope,
  type WeatherPrecipitationType,
  type WeatherRegionId,
} from '../../../entities/weather';
import { isAppError } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

export type WeatherNowcastViewProps = Readonly<{
  data: WeatherNowcastEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
  region: WeatherRegionId;
}>;

const kstTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

const measurementFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
});

const precipitationLabels: Record<WeatherPrecipitationType, string> = {
  none: '없음',
  rain: '비',
  'rain-snow': '비 또는 눈',
  snow: '눈',
  raindrop: '빗방울',
  'raindrop-snow-flurry': '빗방울과 눈날림',
  'snow-flurry': '눈날림',
};

const createFreshness = (observedAt: number): PanelFreshness => ({
  dateTime: new Date(observedAt).toISOString(),
  label: `${kstTimeFormatter.format(observedAt)} 기준`,
});

const formatMeasurement = (value: number | null, unit: string): string =>
  value === null ? '관측 없음' : `${measurementFormatter.format(value)}${unit}`;

const formatPrecipitationType = (value: WeatherPrecipitationType | null): string =>
  value === null ? '관측 없음' : precipitationLabels[value];

type WeatherDatumProps = Readonly<{
  label: string;
  value: string;
}>;

function WeatherDatum({ label, value }: WeatherDatumProps) {
  return (
    <div className="min-w-0 border-l-2 border-accent bg-surface-raised px-3 py-3">
      <dt className="font-data text-xs font-semibold tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function WeatherMeasurements({ nowcast }: { nowcast: WeatherNowcast }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <WeatherDatum label="기온" value={formatMeasurement(nowcast.temperatureCelsius, ' °C')} />
      <WeatherDatum label="습도" value={formatMeasurement(nowcast.relativeHumidityPercent, ' %')} />
      <WeatherDatum label="1시간 강수" value={formatMeasurement(nowcast.precipitationLastHourMm, ' mm')} />
      <WeatherDatum label="강수 형태" value={formatPrecipitationType(nowcast.precipitationType)} />
      <WeatherDatum label="풍속" value={formatMeasurement(nowcast.windSpeedMetersPerSecond, ' m/s')} />
      <WeatherDatum label="풍향" value={formatMeasurement(nowcast.windDirectionDegrees, '°')} />
    </dl>
  );
}

export function WeatherNowcastView({ data, error, isPending, onRetry, region }: WeatherNowcastViewProps) {
  const title = `${WEATHER_REGIONS[region].name} 기상 실황`;
  const commonProps = {
    description: '기상청 초단기실황 · 5 km 격자 대표 관측',
    source: 'KMA',
    title,
  } as const;

  if (data?.data) {
    const content = <WeatherMeasurements nowcast={data.data} />;
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
    return <Panel {...commonProps} message="현재 제공할 수 있는 기상 관측값이 없습니다." status="empty" />;
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
      message="기상 실황을 불러오지 못했습니다. 잠시 후 다시 시도하세요."
      onRetry={onRetry}
      status="error"
    />
  );
}
