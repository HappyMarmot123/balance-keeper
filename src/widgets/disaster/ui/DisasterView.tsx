import type { DisasterAlert, DisasterSnapshot, disasterDataSchema } from '../../../entities/disaster';
import { isAppError, type SuccessEnvelope } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

type DisasterEnvelope = SuccessEnvelope<typeof disasterDataSchema>;

export type DisasterViewProps = Readonly<{
  data: DisasterEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  newAlertIds: readonly string[];
  onRegionChange: (region: string) => void;
  onRetry: () => void;
  selectedRegion: string;
}>;

const REGION_OPTIONS = [
  '전체',
  '서울특별시',
  '부산광역시',
  '대구광역시',
  '인천광역시',
  '광주광역시',
  '대전광역시',
  '울산광역시',
  '세종특별자치시',
  '경기도',
  '강원특별자치도',
  '충청북도',
  '충청남도',
  '전북특별자치도',
  '전라남도',
  '경상북도',
  '경상남도',
  '제주특별자치도',
] as const;

const urgencyStyles = {
  긴급재난: 'border-warning bg-warning-soft text-warning',
  안전안내: 'border-accent bg-surface-raised text-accent',
  위급재난: 'border-danger bg-danger-soft text-danger',
} as const;

const collectedTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

const issuedTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
});

const formatParts = (formatter: Intl.DateTimeFormat, epochMs: number) =>
  Object.fromEntries(formatter.formatToParts(epochMs).map((part) => [part.type, part.value]));

const createFreshness = (fetchedAt: number): PanelFreshness => ({
  dateTime: new Date(fetchedAt).toISOString(),
  label: `${collectedTimeFormatter.format(fetchedAt)} 수집`,
});

const formatIssuedAt = (issuedAt: number): string => {
  const parts = formatParts(issuedTimeFormatter, issuedAt);
  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
};

function DisasterAlertRow({ alert }: { alert: DisasterAlert }) {
  return (
    <li className={`grid min-w-0 gap-2 border-l-2 px-3 py-3 ${urgencyStyles[alert.emergencyStep]}`}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2 font-data text-xs font-semibold">
          <span>{alert.emergencyStep}</span>
          <span className="text-foreground">{alert.disasterType}</span>
        </div>
        <time className="font-data text-xs text-muted" dateTime={new Date(alert.issuedAt).toISOString()}>
          {formatIssuedAt(alert.issuedAt)}
        </time>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm font-semibold text-foreground">{alert.message}</p>
      <p className="break-words font-data text-xs text-muted">{alert.regionText}</p>
    </li>
  );
}

const appliesToRegion = (alert: DisasterAlert, selectedRegion: string): boolean =>
  selectedRegion === '전체' || alert.regionText.includes('전국') || alert.regionText.includes(selectedRegion);

function DisasterContent({
  newAlertIds,
  onRegionChange,
  selectedRegion,
  snapshot,
}: {
  newAlertIds: readonly string[];
  onRegionChange: (region: string) => void;
  selectedRegion: string;
  snapshot: DisasterSnapshot;
}) {
  const visibleAlerts = snapshot.alerts.filter((alert) => appliesToRegion(alert, selectedRegion)).slice(0, 6);
  const alertIds = new Set(snapshot.alerts.map((alert) => alert.id));
  const newAlertCount = new Set(newAlertIds.filter((id) => alertIds.has(id))).size;

  return (
    <div className="grid min-w-0 gap-3">
      {newAlertCount > 0 ? (
        <p
          className="flex items-center gap-2 border-l-2 border-accent bg-surface-inset px-3 py-2 text-sm"
          role="status"
        >
          <span className="font-data text-xs font-bold text-accent">NEW</span>
          <span>새 재난문자 {newAlertCount}건이 도착했습니다.</span>
        </p>
      ) : null}

      <label className="flex min-w-0 items-center justify-between gap-3 font-data text-xs text-muted">
        <span>지역 필터</span>
        <select
          aria-label="지역 필터"
          className="min-w-0 rounded-sm border border-boundary-strong bg-surface-raised px-2 py-1.5 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onChange={(event) => {
            onRegionChange(event.currentTarget.value);
          }}
          value={selectedRegion}
        >
          {REGION_OPTIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </select>
      </label>

      {visibleAlerts.length === 0 ? (
        <p className="text-sm text-muted">선택한 지역에 표시할 최근 재난문자가 없습니다.</p>
      ) : (
        <ol aria-label="최근 긴급재난문자" className="grid min-w-0 gap-2">
          {visibleAlerts.map((alert) => (
            <DisasterAlertRow alert={alert} key={alert.id} />
          ))}
        </ol>
      )}

      <p className="font-data text-xs text-muted">
        공공누리 제4유형 기준 · 출처 표시 · 비상업 · 원문 변경 없음
        {snapshot.alerts.length > visibleAlerts.length
          ? ` · 총 ${snapshot.alerts.length}건 중 조건에 맞는 최신 ${visibleAlerts.length}건`
          : ` · ${visibleAlerts.length}건`}
      </p>
    </div>
  );
}

export function DisasterView({
  data,
  error,
  isPending,
  newAlertIds,
  onRegionChange,
  onRetry,
  selectedRegion,
}: DisasterViewProps) {
  const commonProps = {
    description: '행정안전부 원문 · 최근 2일',
    source: data?.meta.source.replaceAll('+', ' · ') ?? '행정안전부 · Safetydata',
    title: '긴급재난문자',
  } as const;

  if (data !== undefined) {
    if (data.data.alerts.length === 0 && error === null && data.meta.cache !== 'STALE') {
      return <Panel {...commonProps} message="최근 2일 범위에 제공된 재난문자가 없습니다." status="empty" />;
    }

    const freshness = createFreshness(data.meta.fetchedAt);
    const content = (
      <DisasterContent
        newAlertIds={data.meta.cache === 'STALE' || error !== null ? [] : newAlertIds}
        onRegionChange={onRegionChange}
        selectedRegion={selectedRegion}
        snapshot={data.data}
      />
    );

    if (data.meta.cache === 'STALE') {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="게이트웨이가 마지막 성공 재난문자를 제공하고 있습니다."
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
          message="새 재난문자를 가져오지 못해 마지막 성공 재난문자를 표시합니다."
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

  if (!isPending && isAppError(error) && error.code === 'MISSING_CREDENTIALS') {
    return <Panel {...commonProps} status="missing-credential" />;
  }

  if (!isPending && error !== null) {
    return (
      <Panel
        {...commonProps}
        code={isAppError(error) ? error.code : undefined}
        message="재난문자를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
        onRetry={onRetry}
        status="error"
      />
    );
  }

  return <Panel {...commonProps} status="loading" />;
}
