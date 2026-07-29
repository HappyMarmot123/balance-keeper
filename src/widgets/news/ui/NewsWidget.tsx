import { useQuery } from '@tanstack/preact-query';

import { newsQueryOptions } from '../../../entities/news';
import { NewsView } from './NewsView';

export function NewsWidget() {
  const query = useQuery(newsQueryOptions());

  return (
    <NewsView
      data={query.data}
      error={query.error}
      isPending={query.isPending}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
