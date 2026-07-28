import type { EarthquakeEvent, EarthquakeSnapshot, earthquakeDataSchema } from '../../../entities/earthquake';
import { isAppError, type SuccessEnvelope } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

type EarthquakeEnvelope = SuccessEnvelope<typeof earthquakeDataSchema>;

export type EarthquakeViewProps = Readonly<{
  data: EarthquakeEnvelope | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
}>;

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
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

const measurementFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
});

const createFreshness = (fetchedAt: number): PanelFreshness => ({
  dateTime: new Date(fetchedAt).toISOString(),
  label: `${timeFormatter.format(fetchedAt)} 수집`,
});

const formatEventTime = (epochMs: number): string => {
  const parts = Object.fromEntries(eventTimeFormatter.formatToParts(epochMs).map((part) => [part.type, part.value]));
  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
};

const sourceLabel = (event: EarthquakeEvent): string =>
  event.sourceRefs.map((sourceRef) => sourceRef.provider).join(' · ');

function EarthquakeRow({ event }: { event: EarthquakeEvent }) {
  return (
    <li className="grid min-w-0 gap-2 border-l-2 border-accent bg-surface-raised px-3 py-3">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-data text-lg font-semibold tabular-nums">
          M {event.magnitude === null ? '—' : measurementFormatter.format(event.magnitude)}
        </p>
        <time className="font-data text-xs text-muted" dateTime={new Date(event.occurredAt).toISOString()}>
          {formatEventTime(event.occurredAt)}
        </time>
      </div>
      <p className="min-w-0 break-words text-sm font-semibold">{event.location ?? '위치 정보 없음'}</p>
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-data text-xs text-muted">
        <span>깊이 {event.depthKm === null ? '—' : `${measurementFormatter.format(event.depthKm)} km`}</span>
        <span>{sourceLabel(event)}</span>
        {event.intensity === null ? null : <span>{event.intensity}</span>}
      </div>
    </li>
  );
}

const partialMessage = (snapshot: EarthquakeSnapshot): string | undefined => {
  if (snapshot.sources.kma.status === 'missing-credential') {
    return '기상청 연결 설정이 없어 USGS 최근 7일 자료만 표시합니다.';
  }
  if (snapshot.sources.kma.status === 'unavailable') {
    return '기상청 자료를 가져오지 못해 USGS 최근 7일 자료만 표시합니다.';
  }
  if (snapshot.sources.usgs.status === 'unavailable') {
    return 'USGS 자료를 가져오지 못해 기상청 최근 3일 통보만 표시합니다.';
  }
  return undefined;
};

function EarthquakeEvents({ snapshot }: { snapshot: EarthquakeSnapshot }) {
  const message = partialMessage(snapshot);
  const visibleEvents = snapshot.events.slice(0, 5);

  return (
    <div className="grid min-w-0 gap-3">
      {message === undefined ? null : (
        <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-sm" role="status">
          {message}
        </p>
      )}
      {visibleEvents.length === 0 ? (
        <p className="text-sm text-muted">현재 사용 가능한 source에 표시할 지진 통보가 없습니다.</p>
      ) : (
        <ol aria-label="최근 지진" className="grid min-w-0 gap-2">
          {visibleEvents.map((event) => (
            <EarthquakeRow event={event} key={event.id} />
          ))}
        </ol>
      )}
      <p className="font-data text-xs text-muted">
        KMA 최근 3일 · USGS M2.5+ 최근 7일
        {snapshot.events.length > visibleEvents.length
          ? ` · 총 ${snapshot.events.length}건 중 최신 ${visibleEvents.length}건`
          : ` · ${snapshot.events.length}건`}
      </p>
    </div>
  );
}

export function EarthquakeView({ data, error, isPending, onRetry }: EarthquakeViewProps) {
  const commonProps = {
    description: '기상청 통보 · USGS M2.5+ 주간 피드',
    source: data === undefined ? 'KMA · USGS' : data.meta.source.replaceAll('+', ' · '),
    title: '동아시아 지진',
  } as const;

  if (data !== undefined) {
    if (
      data.data.events.length === 0 &&
      data.data.sources.kma.status === 'available' &&
      data.data.sources.usgs.status === 'available' &&
      error === null &&
      data.meta.cache !== 'STALE'
    ) {
      return <Panel {...commonProps} message="최근 제공 범위에 표시할 지진 통보가 없습니다." status="empty" />;
    }

    const content = <EarthquakeEvents snapshot={data.data} />;
    const freshness = createFreshness(data.meta.fetchedAt);

    if (data.meta.cache === 'STALE') {
      return (
        <Panel
          {...commonProps}
          freshness={freshness}
          message="게이트웨이가 마지막 성공 지진 정보를 제공하고 있습니다."
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
          message="새 정보를 가져오지 못해 마지막 성공 지진 정보를 표시합니다."
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
        message="지진 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
        onRetry={onRetry}
        status="error"
      />
    );
  }

  return <Panel {...commonProps} status="loading" />;
}
