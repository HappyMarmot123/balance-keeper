import { useQuery } from '@tanstack/preact-query';

import { macroQueryOptions } from '../../../entities/macro';
import { MacroView } from './MacroView';

export function MacroWidget() {
  const query = useQuery(macroQueryOptions());

  return (
    <MacroView
      data={query.data}
      error={query.error}
      isPending={query.isPending}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
