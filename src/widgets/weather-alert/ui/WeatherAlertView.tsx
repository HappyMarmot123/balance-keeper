import {
  WEATHER_ALERT_SOURCE,
  type WeatherAlert,
  type WeatherAlertBulletin,
  type WeatherAlertEnvelope,
  type WeatherAlertKind,
  type WeatherAlertLevel,
} from '../../../entities/weather-alert';
import { isAppError } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

export type WeatherAlertViewProps = Readonly<{
  data: WeatherAlertEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
}>;

const collectedTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

const eventTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
});

const kindLabels: Record<Exclude<WeatherAlertKind, 'unknown'>, string> = {
  'cold-wave': '한파',
  dry: '건조',
  'heavy-rain': '호우',
  'heavy-snow': '대설',
  'heat-wave': '폭염',
  'high-waves': '풍랑',
  'storm-surge': '폭풍해일',
  'strong-wind': '강풍',
  'tropical-night': '열대야',
  typhoon: '태풍',
  'yellow-dust': '황사',
};

const levelLabels: Record<Exclude<WeatherAlertLevel, 'unknown'>, string> = {
  advisory: '주의보',
  'emergency-warning': '긴급경보',
  warning: '경보',
};

const commandLabels = {
  correction: '정정',
  extend: '연장',
  issue: '발표',
  'change-issue': '변경 발표',
} as const;

const levelStyles: Record<WeatherAlertLevel, string> = {
  advisory: 'border-warning bg-warning-soft',
  'emergency-warning': 'border-danger bg-danger-soft',
  unknown: 'border-boundary-strong bg-surface-raised',
  warning: 'border-danger bg-danger-soft',
};

const levelTextStyles: Record<WeatherAlertLevel, string> = {
  advisory: 'text-warning',
  'emergency-warning': 'text-danger',
  unknown: 'text-muted',
  warning: 'text-danger',
};

const createFreshness = (fetchedAt: number): PanelFreshness => ({
  dateTime: new Date(fetchedAt).toISOString(),
  label: `${collectedTimeFormatter.format(fetchedAt)} 확인`,
});

const formatEventTime = (epochMs: number): string => {
  const parts = Object.fromEntries(eventTimeFormatter.formatToParts(epochMs).map((part) => [part.type, part.value]));
  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
};

const formatKind = (alert: WeatherAlert): string =>
  alert.kind === 'unknown' ? `종류 확인 불가 (${alert.kindCode})` : kindLabels[alert.kind];

const formatLevel = (alert: WeatherAlert): string =>
  alert.level === 'unknown' ? `수준 확인 불가 (${alert.levelCode})` : levelLabels[alert.level];

function AlertTime({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <dt className="font-data text-xs font-semibold text-muted">{label}</dt>
      <dd>
        <time className="font-data text-xs tabular-nums text-muted" dateTime={new Date(value).toISOString()}>
          {formatEventTime(value)}
        </time>
      </dd>
    </div>
  );
}

function WeatherAlertRow({ alert }: { alert: WeatherAlert }) {
  return (
    <li className={`grid min-w-0 content-start gap-3 border-l-2 px-3 py-3 ${levelStyles[alert.level]}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 font-data text-xs font-semibold">
        <span className={levelTextStyles[alert.level]}>{formatLevel(alert)}</span>
        <span className="text-foreground">{formatKind(alert)}</span>
        <span className="text-muted">{commandLabels[alert.command]}</span>
      </div>
      <h3 className="min-w-0 break-words text-sm font-semibold">{alert.areaName}</h3>
      <dl className="grid min-w-0 gap-1">
        <AlertTime label="발표" value={alert.issuedAt} />
        <AlertTime label="발효" value={alert.effectiveAt} />
        {alert.endsAt === null ? null : <AlertTime label="종료" value={alert.endsAt} />}
      </dl>
    </li>
  );
}

function WeatherAlertBulletinView({ bulletin }: { bulletin: WeatherAlertBulletin }) {
  if (bulletin.availability === 'unavailable') {
    return (
      <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-sm" role="status">
        최근 통보문을 가져오지 못했습니다. 현재 발효 현황만 표시합니다.
      </p>
    );
  }

  return (
    <aside
      aria-label="최근 기상특보 통보문"
      className="grid min-w-0 gap-1 border-l-2 border-accent bg-surface-inset px-3 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words text-sm font-semibold">{bulletin.title}</p>
        <time
          className="font-data text-xs tabular-nums text-muted"
          dateTime={new Date(bulletin.issuedAt).toISOString()}
        >
          {formatEventTime(bulletin.issuedAt)}
        </time>
      </div>
      {bulletin.details === null ? null : (
        <p className="whitespace-pre-wrap break-words text-sm text-muted">{bulletin.details}</p>
      )}
    </aside>
  );
}

function WeatherAlertContent({ snapshot }: { snapshot: NonNullable<WeatherAlertEnvelope['data']> }) {
  const visibleAlerts = snapshot.alerts.slice(0, 6);

  return (
    <div className="grid min-w-0 gap-3">
      <WeatherAlertBulletinView bulletin={snapshot.bulletin} />
      <ol
        aria-label="현재 발효 중인 기상특보"
        className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3"
      >
        {visibleAlerts.map((alert) => (
          <WeatherAlertRow alert={alert} key={alert.id} />
        ))}
      </ol>
      <div className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1 font-data text-xs text-muted">
        <p>{WEATHER_ALERT_SOURCE.license} · 출처 표시</p>
        <p>
          {snapshot.alerts.length > visibleAlerts.length
            ? `총 ${snapshot.alerts.length}건 중 우선순위 ${visibleAlerts.length}건`
            : `현재 발효 ${visibleAlerts.length}건`}
        </p>
      </div>
    </div>
  );
}

const lastKnownEmpty = <p className="text-sm text-muted">마지막 확인 시점에는 발효 중인 기상특보가 없었습니다.</p>;

export function WeatherAlertView({ data, error, isPending, onRetry }: WeatherAlertViewProps) {
  const commonProps = {
    description: '기상청 현재 발효 현황',
    source: data?.meta.source.replaceAll('+', ' · ') ?? 'KMA',
    title: '기상특보',
  } as const;

  if (data !== undefined) {
    const freshness = createFreshness(data.meta.fetchedAt);
    const content = data.data === null ? lastKnownEmpty : <WeatherAlertContent snapshot={data.data} />;

    if (data.meta.cache === 'STALE') {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="게이트웨이가 마지막 성공 기상특보 현황을 제공하고 있습니다."
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
          message="새 현황을 가져오지 못해 마지막 확인 결과를 표시합니다."
          status="stale"
        >
          {content}
        </Panel>
      );
    }

    if (data.data === null) {
      return <Panel {...commonProps} message="현재 발효 중인 기상특보가 없습니다." status="empty" />;
    }

    return (
      <Panel {...commonProps} freshness={freshness} status="success">
        {content}
      </Panel>
    );
  }

  if (!isPending && isAppError(error) && error.code === 'MISSING_CREDENTIALS') {
    return <Panel {...commonProps} status="missing-credential" />;
  }

  if (!isPending && error !== null) {
    return (
      <Panel
        {...commonProps}
        code={isAppError(error) ? error.code : undefined}
        message="기상특보를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
        onRetry={onRetry}
        status="error"
      />
    );
  }

  return <Panel {...commonProps} status="loading" />;
}
