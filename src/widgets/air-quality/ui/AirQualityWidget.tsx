import { useQuery } from '@tanstack/preact-query';

import { airQualityQueryOptions } from '../../../entities/air-quality';
import { AirQualityView } from './AirQualityView';

export function AirQualityWidget() {
  const query = useQuery(airQualityQueryOptions('seoul'));

  return (
    <AirQualityView
      data={query.data}
      error={query.error}
      isPending={query.isPending}
      onRetry={() => {
        void query.refetch();
      }}
      region="seoul"
    />
  );
}
