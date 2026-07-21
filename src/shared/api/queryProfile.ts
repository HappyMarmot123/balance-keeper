import { isAppError } from '../contracts/AppError';

export interface QueryProfileInput {
  staleTime: number;
  refetchInterval: number | false;
}

export const shouldRetryQuery = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= 2 || !isAppError(error)) {
    return false;
  }

  if (error.name === 'AbortError') {
    return false;
  }

  if (error.code === 'NETWORK_ERROR') {
    return true;
  }

  return (
    (error.code === 'UPSTREAM_UNAVAILABLE' && error.status === 502) ||
    (error.code === 'SERVICE_UNAVAILABLE' && error.status === 503)
  );
};

export const createQueryProfile = ({ staleTime, refetchInterval }: QueryProfileInput) => ({
  staleTime,
  refetchInterval,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchIntervalInBackground: false,
  retry: shouldRetryQuery,
});
