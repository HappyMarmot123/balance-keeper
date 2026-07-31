import { useQuery } from '@tanstack/preact-query';
import { useEffect, useState } from 'preact/hooks';

import { weatherForecastQueryOptions } from '../../../entities/weather';
import { WeatherForecastView } from './WeatherForecastView';

const HOUR_MS = 60 * 60_000;

const useForecastClock = (): number => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const delayUntilNextHour = HOUR_MS - (now % HOUR_MS) + 1;
    const timeoutId = globalThis.setTimeout(() => {
      setNow(Date.now());
    }, delayUntilNextHour);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [now]);

  return now;
};

export function WeatherForecastWidget() {
  const query = useQuery(weatherForecastQueryOptions('seoul'));
  const now = useForecastClock();

  return (
    <WeatherForecastView
      data={query.data}
      error={query.error}
      isPending={query.isPending}
      now={now}
      onRetry={() => {
        void query.refetch();
      }}
      region="seoul"
    />
  );
}
