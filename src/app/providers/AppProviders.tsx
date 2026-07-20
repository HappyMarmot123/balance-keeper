import { QueryClientProvider } from '@tanstack/preact-query';
import type { ComponentChildren } from 'preact';

import { queryClient } from '../../shared/api';

type AppProvidersProps = {
  children: ComponentChildren;
};

export function AppProviders({ children }: AppProvidersProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
