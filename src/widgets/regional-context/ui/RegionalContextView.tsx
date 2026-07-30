import type { ComponentChildren } from 'preact';

import type { EarthquakeSnapshot } from '../../../entities/earthquake';
import type { MarketSnapshot } from '../../../entities/market';
import type { NewsSnapshot } from '../../../entities/news';
import type { WeatherNowcastData } from '../../../entities/weather';
import { isAppError, type SuccessMeta } from '../../../shared/contracts';
import { Panel, type PanelFreshness } from '../../../shared/ui';

type RegionalContextEnvelope<Data> = Readonly<{
  data: Data;
  meta: SuccessMeta;
}>;

type RegionalContextSourceStateLike = Readonly<{
  data: Readonly<{ meta: SuccessMeta }> | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
}>;

export type RegionalContextSourceState<Data> = Readonly<{
  data: RegionalContextEnvelope<Data> | undefined;
  error: unknown | null;
  isPending: boolean;
  onRetry: () => void;
}>;

export type RegionalContextViewProps = Readonly<{
  earthquake: RegionalContextSourceState<EarthquakeSnapshot>;
  markets: RegionalContextSourceState<MarketSnapshot>;
  news: RegionalContextSourceState<NewsSnapshot>;
  weather: RegionalContextSourceState<WeatherNowcastData>;
}>;

type SignalTime = Readonly<{
  dateTime: string;
  label: string;
}>;

type SignalStatus = Readonly<{
  label: 'EMPTY' | 'ERROR' | 'LOADING' | 'PARTIAL' | 'SETUP' | 'STALE';
  message: string;
}>;

type SignalRowProps = Readonly<{
  code: 'EA-EQ' | 'KR-MKT' | 'KR-PRESS' | 'KR-WX';
  collectedAt?: number;
  detail?: string;
  factTime?: SignalTime;
  source: string;
  status?: SignalStatus;
  title: string;
  value: ComponentChildren;
}>;

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Seoul',
  year: 'numeric',
});

const measurementFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
});

const marketFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const formatParts = (epochMs: number) =>
  Object.fromEntries(dateTimeFormatter.formatToParts(epochMs).map((part) => [part.type, part.value]));

const formatShortDateTime = (epochMs: number): string => {
  const parts = formatParts(epochMs);
  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
};

const createFactTime = (epochMs: number, suffix: string): SignalTime => ({
  dateTime: new Date(epochMs).toISOString(),
  label: `${formatShortDateTime(epochMs)} ${suffix}`,
});

const createFreshness = (fetchedAt: number): PanelFreshness => {
  const parts = formatParts(fetchedAt);

  return {
    dateTime: new Date(fetchedAt).toISOString(),
    label: `가장 오래된 수집 · ${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`,
  };
};

const createMarketFactTime = (date: string): SignalTime => ({
  dateTime: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
  label: `${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)} 최근 거래일`,
});

const sourceHasStaleSignal = (state: RegionalContextSourceStateLike, hasSignal: boolean): boolean =>
  hasSignal && state.data !== undefined && (state.data.meta.cache === 'STALE' || state.error !== null);

const missingSourceStatus = (state: RegionalContextSourceStateLike): SignalStatus => {
  if (state.error !== null) {
    return isAppError(state.error) && state.error.code === 'MISSING_CREDENTIALS'
      ? { label: 'SETUP', message: '연결 설정 필요' }
      : { label: 'ERROR', message: '일시적으로 확인 불가' };
  }

  return state.isPending ? { label: 'LOADING', message: '불러오는 중' } : { label: 'ERROR', message: '현재 확인 불가' };
};

const retainedStatus = (state: RegionalContextSourceStateLike, hasSignal: boolean): SignalStatus | undefined => {
  if (state.data === undefined) {
    return missingSourceStatus(state);
  }
  if (state.error !== null) {
    if (isAppError(state.error) && state.error.code === 'MISSING_CREDENTIALS') {
      return {
        label: 'SETUP',
        message: hasSignal ? '연결 설정 필요 · 마지막 성공 자료' : '연결 설정 필요',
      };
    }

    return hasSignal
      ? { label: 'STALE', message: '새로고침 실패 · 마지막 성공 자료' }
      : { label: 'ERROR', message: '새로고침 실패 · 현재 확인 불가' };
  }
  if (state.data.meta.cache === 'STALE') {
    return { label: 'STALE', message: '게이트웨이 마지막 성공 자료' };
  }
  return undefined;
};

function SignalRow({ code, collectedAt, detail, factTime, source, status, title, value }: SignalRowProps) {
  return (
    <li className="grid min-w-0 gap-2 border-l-2 border-accent bg-surface-raised px-3 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-data text-xs font-bold tracking-wide text-accent">{code}</span>
        <h3 className="min-w-0 break-words text-sm font-semibold">{title}</h3>
        {status === undefined ? null : (
          <span className="ml-auto flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span className="font-data font-bold text-warning">{status.label}</span>
            <span className="min-w-0 break-words text-muted">{status.message}</span>
          </span>
        )}
      </div>

      <p className="min-w-0 break-words font-data text-sm font-semibold tabular-nums">{value}</p>
      {detail === undefined ? null : <p className="min-w-0 break-words text-xs text-muted">{detail}</p>}

      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-data text-xs text-muted">
        <span className="min-w-0 break-words">{source}</span>
        {factTime === undefined ? null : <time dateTime={factTime.dateTime}>{factTime.label}</time>}
        {collectedAt === undefined ? null : (
          <time dateTime={new Date(collectedAt).toISOString()}>{formatShortDateTime(collectedAt)} 수집</time>
        )}
      </div>
    </li>
  );
}

const weatherHasSignal = (state: RegionalContextViewProps['weather']): boolean =>
  state.data?.data !== null && state.data !== undefined;

function WeatherSignal({ state }: { state: RegionalContextViewProps['weather'] }) {
  if (state.data === undefined) {
    return (
      <SignalRow
        code="KR-WX"
        source="KMA"
        status={missingSourceStatus(state)}
        title="서울 기상"
        value="현재 확인 불가"
      />
    );
  }

  const snapshot = state.data.data;
  if (snapshot === null) {
    const status =
      state.error !== null || state.data.meta.cache === 'STALE'
        ? retainedStatus(state, false)
        : { label: 'EMPTY' as const, message: '제공 자료 없음' };
    return (
      <SignalRow
        code="KR-WX"
        collectedAt={state.data.meta.fetchedAt}
        source={state.data.meta.source}
        status={status}
        title="서울 기상"
        value={status?.label === 'EMPTY' ? '관측값 없음' : '현재 확인 불가'}
      />
    );
  }

  const temperature =
    snapshot.temperatureCelsius === null
      ? '기온 관측 없음'
      : `${measurementFormatter.format(snapshot.temperatureCelsius)} °C`;
  const humidity =
    snapshot.relativeHumidityPercent === null
      ? '습도 관측 없음'
      : `습도 ${measurementFormatter.format(snapshot.relativeHumidityPercent)} %`;

  return (
    <SignalRow
      code="KR-WX"
      collectedAt={state.data.meta.fetchedAt}
      factTime={createFactTime(snapshot.observedAt, '관측')}
      source={state.data.meta.source}
      status={retainedStatus(state, true)}
      title="서울 기상"
      value={`${temperature} · ${humidity}`}
    />
  );
}

const earthquakeHasSignal = (state: RegionalContextViewProps['earthquake']): boolean =>
  (state.data?.data.events.length ?? 0) > 0;

const earthquakeProviderIssues = (snapshot: EarthquakeSnapshot): string[] => {
  const issues: string[] = [];

  if (snapshot.sources.kma.status === 'missing-credential') {
    issues.push('KMA 연결 설정 필요');
  } else if (snapshot.sources.kma.status === 'unavailable') {
    issues.push('KMA 확인 불가');
  }
  if (snapshot.sources.usgs.status === 'unavailable') {
    issues.push('USGS 확인 불가');
  }

  return issues;
};

function EarthquakeSignal({ state }: { state: RegionalContextViewProps['earthquake'] }) {
  if (state.data === undefined) {
    return (
      <SignalRow
        code="EA-EQ"
        source="KMA · USGS"
        status={missingSourceStatus(state)}
        title="동아시아 지진"
        value="현재 확인 불가"
      />
    );
  }

  const snapshot = state.data.data;
  const hasSignal = snapshot.events.length > 0;
  const latestEvent = snapshot.events[0];
  const magnitudes = snapshot.events.flatMap((event) => (event.magnitude === null ? [] : [event.magnitude]));
  const maximumMagnitude = magnitudes.length === 0 ? null : Math.max(...magnitudes);
  const providerIssues = earthquakeProviderIssues(snapshot);
  const retained = retainedStatus(state, hasSignal);
  const status =
    retained ??
    (providerIssues.length > 0
      ? { label: 'PARTIAL' as const, message: providerIssues.join(' · ') }
      : hasSignal
        ? undefined
        : { label: 'EMPTY' as const, message: '제공 범위 내 통보 없음' });
  const value = hasSignal
    ? `최근 7일 ${snapshot.events.length}건 · 최대 ${maximumMagnitude === null ? '규모 미제공' : `M ${measurementFormatter.format(maximumMagnitude)}`}`
    : retained === undefined
      ? providerIssues.length === 0
        ? '최근 7일 통보 없음'
        : '사용 가능한 소스에 표시할 통보 없음'
      : '현재 확인 불가';

  return (
    <SignalRow
      code="EA-EQ"
      collectedAt={state.data.meta.fetchedAt}
      detail={latestEvent?.location ?? undefined}
      factTime={
        latestEvent === undefined
          ? createFactTime(snapshot.window.to, '조회 범위 종료')
          : createFactTime(latestEvent.occurredAt, '발생')
      }
      source={state.data.meta.source.replaceAll('+', ' · ')}
      status={status}
      title="동아시아 지진"
      value={value}
    />
  );
}

const marketsHaveSignal = (state: RegionalContextViewProps['markets']): boolean =>
  state.data?.data.indices.some((index) => index.observation !== null) ?? false;

function MarketSignal({ state }: { state: RegionalContextViewProps['markets'] }) {
  if (state.data === undefined) {
    return (
      <SignalRow
        code="KR-MKT"
        source="금융위원회 · 한국거래소"
        status={missingSourceStatus(state)}
        title="국내 시장"
        value="현재 확인 불가"
      />
    );
  }

  const snapshot = state.data.data;
  const available = snapshot.indices.filter(
    (index): index is typeof index & { observation: NonNullable<typeof index.observation> } =>
      index.observation !== null,
  );
  const hasSignal = available.length > 0;
  const unavailable = snapshot.indices.filter((index) => index.status === 'unavailable');
  const retained = retainedStatus(state, hasSignal);
  const status =
    retained ??
    (unavailable.length > 0
      ? { label: 'PARTIAL' as const, message: `${unavailable.map((index) => index.label).join(' · ')} 확인 불가` }
      : hasSignal
        ? undefined
        : { label: 'EMPTY' as const, message: '최근 종가 없음' });
  const latestDate = available
    .map((index) => index.observation.date)
    .sort()
    .at(-1);

  return (
    <SignalRow
      code="KR-MKT"
      collectedAt={state.data.meta.fetchedAt}
      detail="다음 영업일 13시 이후 · 하루 지연"
      factTime={latestDate === undefined ? undefined : createMarketFactTime(latestDate)}
      source={state.data.meta.source}
      status={status}
      title="국내 시장"
      value={
        hasSignal
          ? available.map((index) => `${index.label} ${marketFormatter.format(index.observation.close)}`).join(' · ')
          : retained === undefined
            ? unavailable.length === 0
              ? '최근 종가 없음'
              : '사용 가능한 지수에 최근 종가 없음'
            : '현재 확인 불가'
      }
    />
  );
}

const newsHasSignal = (state: RegionalContextViewProps['news']): boolean => (state.data?.data.items.length ?? 0) > 0;

function NewsSignal({ state }: { state: RegionalContextViewProps['news'] }) {
  if (state.data === undefined) {
    return (
      <SignalRow
        code="KR-PRESS"
        source="MCST · MOIS"
        status={missingSourceStatus(state)}
        title="국내 정책"
        value="현재 확인 불가"
      />
    );
  }

  const snapshot = state.data.data;
  const latestItem = snapshot.items[0];
  const hasSignal = latestItem !== undefined;
  const unavailable = snapshot.sources.filter((source) => source.status === 'unavailable');
  const retained = retainedStatus(state, hasSignal);
  const status =
    retained ??
    (unavailable.length > 0
      ? {
          label: 'PARTIAL' as const,
          message: `${unavailable.map((source) => source.label).join(' · ')} 확인 불가`,
        }
      : hasSignal
        ? undefined
        : { label: 'EMPTY' as const, message: '최신 보도자료 없음' });
  const source =
    latestItem === undefined ? undefined : snapshot.sources.find((item) => item.id === latestItem.sourceId);

  return (
    <SignalRow
      code="KR-PRESS"
      collectedAt={state.data.meta.fetchedAt}
      detail={source?.label}
      factTime={latestItem === undefined ? undefined : createFactTime(latestItem.publishedAt, '발표')}
      source={state.data.meta.source.replaceAll('+', ' · ')}
      status={status}
      title="국내 정책"
      value={
        latestItem === undefined ? (
          retained === undefined ? (
            unavailable.length === 0 ? (
              '최신 보도자료 없음'
            ) : (
              '사용 가능한 기관에 최신 보도자료 없음'
            )
          ) : (
            '현재 확인 불가'
          )
        ) : (
          <a
            className="break-words text-accent underline decoration-boundary-strong underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            href={latestItem.originalUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {latestItem.title}
            <span className="sr-only"> (원문 새 창)</span>
          </a>
        )
      }
    />
  );
}

const isAuthoritativeWeatherEmpty = (state: RegionalContextViewProps['weather']): boolean =>
  state.data?.data === null && state.error === null && state.data.meta.cache !== 'STALE';

const isAuthoritativeEarthquakeEmpty = (state: RegionalContextViewProps['earthquake']): boolean =>
  state.data !== undefined &&
  state.data.data.events.length === 0 &&
  state.data.data.sources.kma.status === 'available' &&
  state.data.data.sources.usgs.status === 'available' &&
  state.error === null &&
  state.data.meta.cache !== 'STALE';

const isAuthoritativeMarketsEmpty = (state: RegionalContextViewProps['markets']): boolean => {
  const envelope = state.data;
  if (envelope === undefined) {
    return false;
  }

  return (
    envelope.data.indices.every((index) => index.status === 'empty') &&
    state.error === null &&
    envelope.meta.cache !== 'STALE'
  );
};

const isAuthoritativeNewsEmpty = (state: RegionalContextViewProps['news']): boolean =>
  state.data !== undefined &&
  state.data.data.items.length === 0 &&
  state.data.data.sources.every((source) => source.status === 'empty') &&
  state.error === null &&
  state.data.meta.cache !== 'STALE';

const hasInternalPartial = ({ earthquake, markets, news }: RegionalContextViewProps): boolean =>
  (earthquake.data !== undefined &&
    (earthquake.data.data.sources.kma.status !== 'available' ||
      earthquake.data.data.sources.usgs.status !== 'available')) ||
  (markets.data?.data.indices.some((index) => index.status === 'unavailable') ?? false) ||
  (news.data?.data.sources.some((source) => source.status === 'unavailable') ?? false);

const hasRetryableInternalPartial = ({ earthquake, markets, news }: RegionalContextViewProps): boolean =>
  earthquake.data?.data.sources.kma.status === 'unavailable' ||
  earthquake.data?.data.sources.usgs.status === 'unavailable' ||
  (markets.data?.data.indices.some((index) => index.status === 'unavailable') ?? false) ||
  (news.data?.data.sources.some((source) => source.status === 'unavailable') ?? false);

const isRetryable = (state: RegionalContextSourceStateLike): boolean => {
  if (state.data?.meta.cache === 'STALE') {
    return true;
  }
  if (state.error === null) {
    return false;
  }
  return !(isAppError(state.error) && state.error.code === 'MISSING_CREDENTIALS');
};

function RegionalContextContent({
  isLoadingRemainder,
  isPartial,
  onRetryAll,
  showRetry,
  ...props
}: RegionalContextViewProps &
  Readonly<{
    isLoadingRemainder: boolean;
    isPartial: boolean;
    onRetryAll: () => void;
    showRetry: boolean;
  }>) {
  return (
    <div className="grid min-w-0 gap-3">
      {isPartial ? (
        <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-sm" role="status">
          <span className="mr-2 font-data text-xs font-bold text-warning">PARTIAL</span>
          일부 소스가 연결되지 않아 확인 가능한 정보만 표시합니다.
        </p>
      ) : isLoadingRemainder ? (
        <p className="border-l-2 border-accent bg-surface-inset px-3 py-2 text-sm" role="status">
          <span className="mr-2 font-data text-xs font-bold text-accent">LOADING</span>
          나머지 소스를 불러오는 중입니다.
        </p>
      ) : null}

      <ul aria-label="지역 상황 신호" className="grid min-w-0 gap-2">
        <WeatherSignal state={props.weather} />
        <EarthquakeSignal state={props.earthquake} />
        <MarketSignal state={props.markets} />
        <NewsSignal state={props.news} />
      </ul>

      {showRetry ? (
        <button
          className="w-fit rounded-sm border border-boundary-strong bg-surface-raised px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={onRetryAll}
          type="button"
        >
          모든 소스 다시 불러오기
        </button>
      ) : null}

      <div className="grid gap-1 border-t border-boundary pt-3 text-xs text-muted">
        <p>기상·시장·보도자료는 한국 자료이며, 지진은 북위 21–45°·동경 110–145° 제공 범위입니다.</p>
        <p>동일 지표의 국가별 비교가 아니라, 한국 중심 데이터와 승인된 동아시아 지진 범위를 함께 보여줍니다.</p>
      </div>
    </div>
  );
}

export function RegionalContextView(props: RegionalContextViewProps) {
  const states = [props.weather, props.earthquake, props.markets, props.news] as const;
  const hasSignals = [
    weatherHasSignal(props.weather),
    earthquakeHasSignal(props.earthquake),
    marketsHaveSignal(props.markets),
    newsHasSignal(props.news),
  ] as const;
  const anySignal = hasSignals.some(Boolean);
  const anyEnvelope = states.some((state) => state.data !== undefined);
  const anyPendingWithoutData = states.some((state) => state.data === undefined && state.isPending);
  const allMissingCredentials = states.every(
    (state) => state.data === undefined && isAppError(state.error) && state.error.code === 'MISSING_CREDENTIALS',
  );
  const allAuthoritativeEmpty =
    isAuthoritativeWeatherEmpty(props.weather) &&
    isAuthoritativeEarthquakeEmpty(props.earthquake) &&
    isAuthoritativeMarketsEmpty(props.markets) &&
    isAuthoritativeNewsEmpty(props.news);
  const actualStale = states.some((state, index) => sourceHasStaleSignal(state, hasSignals[index] ?? false));
  const partial =
    states.some((state) => state.data === undefined && (!state.isPending || state.error !== null)) ||
    states.some((state) => state.error !== null) ||
    states.some((state) => state.data?.meta.cache === 'STALE') ||
    hasInternalPartial(props);
  const retryableInternalPartial = hasRetryableInternalPartial(props);
  const retryAll = () => {
    for (const state of states) {
      state.onRetry();
    }
  };
  const commonProps = {
    description: '서울 기상 · 국내 시장·정책 · 동아시아 지진',
    title: '한국 기준 동아시아 상황',
  } as const;

  if (!anySignal && anyPendingWithoutData) {
    return <Panel {...commonProps} message="네 개 소스를 불러오는 중입니다." status="loading" />;
  }

  if (!anySignal && allMissingCredentials) {
    return <Panel {...commonProps} status="missing-credential" />;
  }

  if (allAuthoritativeEmpty) {
    return <Panel {...commonProps} message="현재 네 소스에 표시할 지역 상황 신호가 없습니다." status="empty" />;
  }

  if (!anySignal && !anyEnvelope) {
    const firstError = states.find((state) => state.error !== null)?.error;
    const hasMissingCredential = states.some(
      (state) => isAppError(state.error) && state.error.code === 'MISSING_CREDENTIALS',
    );
    const showRetry = states.some(isRetryable);

    return (
      <Panel
        {...commonProps}
        code={isAppError(firstError) ? firstError.code : undefined}
        message={
          hasMissingCredential
            ? '지역 상황 정보를 불러오지 못했습니다. 일부 소스는 연결 설정이 필요합니다.'
            : '지역 상황 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
        }
        onRetry={showRetry ? retryAll : undefined}
        status="error"
      />
    );
  }

  const fetchedAtValues = states.flatMap((state) => (state.data === undefined ? [] : [state.data.meta.fetchedAt]));
  const freshness = createFreshness(Math.min(...fetchedAtValues));
  const content = (
    <RegionalContextContent
      {...props}
      isLoadingRemainder={anyPendingWithoutData && !partial && !actualStale}
      isPartial={partial && !actualStale}
      onRetryAll={retryAll}
      showRetry={partial && (states.some(isRetryable) || retryableInternalPartial)}
    />
  );

  if (actualStale) {
    return (
      <Panel
        {...commonProps}
        freshness={freshness}
        message="일부 소스가 지연되거나 연결되지 않아 마지막 성공 정보와 확인 가능한 정보만 표시합니다."
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
