import { QueryClient } from '@tanstack/preact-query';

import { shouldRetryQuery } from './queryProfile';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});
