import { useSignal } from '@preact/signals';
import { useQuery } from '@tanstack/preact-query';
import { useEffect, useRef } from 'preact/hooks';

import { type DisasterAlert, disasterQueryOptions } from '../../../entities/disaster';
import type { CacheStatus } from '../../../shared/contracts';
import { DisasterView } from './DisasterView';

const isNewerThan = (candidate: DisasterAlert, previousLatest: DisasterAlert): boolean => {
  if (candidate.issuedAt !== previousLatest.issuedAt) {
    return candidate.issuedAt > previousLatest.issuedAt;
  }
  if (candidate.id.length !== previousLatest.id.length) {
    return candidate.id.length > previousLatest.id.length;
  }
  return candidate.id.localeCompare(previousLatest.id) > 0;
};

export function deriveNewDisasterAlertIds(
  previous: readonly DisasterAlert[] | undefined,
  next: readonly DisasterAlert[],
  cache: CacheStatus,
): readonly string[] {
  const previousLatest = previous?.[0];
  if (previousLatest === undefined || cache === 'STALE') {
    return [];
  }
  const previousIds = new Set((previous ?? []).map((alert) => alert.id));
  return next
    .filter((alert) => !previousIds.has(alert.id) && isNewerThan(alert, previousLatest))
    .map((alert) => alert.id);
}

export function DisasterWidget() {
  const query = useQuery(disasterQueryOptions());
  const selectedRegion = useSignal('전체');
  const newAlertIds = useSignal<readonly string[]>([]);
  const previousAlerts = useRef<readonly DisasterAlert[] | undefined>(undefined);

  useEffect(() => {
    if (query.data === undefined) {
      return;
    }
    const nextAlerts = query.data.data.alerts;
    newAlertIds.value = deriveNewDisasterAlertIds(previousAlerts.current, nextAlerts, query.data.meta.cache);
    if (query.data.meta.cache !== 'STALE') {
      previousAlerts.current = nextAlerts;
    }
  }, [newAlertIds, query.data]);

  return (
    <DisasterView
      data={query.data}
      error={query.error}
      isPending={query.isPending}
      newAlertIds={newAlertIds.value}
      onRegionChange={(region) => {
        selectedRegion.value = region;
      }}
      onRetry={() => {
        void query.refetch();
      }}
      selectedRegion={selectedRegion.value}
    />
  );
}
