import { useQuery } from '@tanstack/preact-query';

import { weatherAlertQueryOptions } from '../../../entities/weather-alert';
import { WeatherAlertView } from './WeatherAlertView';

export function WeatherAlertWidget() {
  const query = useQuery(weatherAlertQueryOptions());

  return (
    <WeatherAlertView
      data={query.data}
      error={query.error}
      isPending={query.isPending}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
