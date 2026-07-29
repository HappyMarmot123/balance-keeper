import { useQuery } from '@tanstack/preact-query';

import { marketQueryOptions } from '../../../entities/market';
import { MarketsView } from './MarketsView';

export function MarketsWidget() {
  const query = useQuery(marketQueryOptions());

  return (
    <MarketsView
      data={query.data}
      error={query.error}
      isPending={query.isPending}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
