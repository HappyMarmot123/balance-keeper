import { useQuery } from '@tanstack/preact-query';

import { earthquakeQueryOptions } from '../../../entities/earthquake';
import { marketQueryOptions } from '../../../entities/market';
import { newsQueryOptions } from '../../../entities/news';
import { weatherNowcastQueryOptions } from '../../../entities/weather';
import { RegionalContextView } from './RegionalContextView';

export function RegionalContextWidget() {
  const weather = useQuery(weatherNowcastQueryOptions('seoul'));
  const earthquake = useQuery(earthquakeQueryOptions());
  const markets = useQuery(marketQueryOptions());
  const news = useQuery(newsQueryOptions());

  return (
    <RegionalContextView
      earthquake={{
        data: earthquake.data,
        error: earthquake.error,
        isPending: earthquake.isPending,
        onRetry: () => {
          void earthquake.refetch();
        },
      }}
      markets={{
        data: markets.data,
        error: markets.error,
        isPending: markets.isPending,
        onRetry: () => {
          void markets.refetch();
        },
      }}
      news={{
        data: news.data,
        error: news.error,
        isPending: news.isPending,
        onRetry: () => {
          void news.refetch();
        },
      }}
      weather={{
        data: weather.data,
        error: weather.error,
        isPending: weather.isPending,
        onRetry: () => {
          void weather.refetch();
        },
      }}
    />
  );
}
