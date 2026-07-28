import { useQuery } from '@tanstack/preact-query';

import { earthquakeQueryOptions } from '../../../entities/earthquake';
import { EarthquakeView } from './EarthquakeView';

export function EarthquakeWidget() {
  const query = useQuery(earthquakeQueryOptions());

  return (
    <EarthquakeView
      data={query.data}
      error={query.error}
      isPending={query.isPending}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
