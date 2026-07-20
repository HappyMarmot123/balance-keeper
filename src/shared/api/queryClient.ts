import { QueryClient } from '@tanstack/preact-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: true,
      staleTime: 60_000,
    },
  },
});
