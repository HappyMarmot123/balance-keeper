import { useQuery } from '@tanstack/preact-query';

import { weatherNowcastQueryOptions } from '../../../entities/weather';
import { WeatherNowcastView } from './WeatherNowcastView';

export function WeatherNowcastWidget() {
  const query = useQuery(weatherNowcastQueryOptions('seoul'));

  return (
    <WeatherNowcastView
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
