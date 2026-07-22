import { AppError } from '../../shared/contracts';
import type { FleetStateStore } from '../cache';

const rejectUnavailable = async (): Promise<never> => {
  throw new AppError('SERVICE_UNAVAILABLE');
};

export function createUnavailableFleetStateStore(): FleetStateStore {
  return Object.freeze({
    readCache: rejectUnavailable,
    writeCache: rejectUnavailable,
    deleteCache: rejectUnavailable,
    tryAcquireLease: rejectUnavailable,
    releaseLease: rejectUnavailable,
    writeCacheIfLeaseOwner: rejectUnavailable,
    deleteCacheIfLeaseOwner: rejectUnavailable,
    consumeFixedWindow: rejectUnavailable,
    acquireBreaker: rejectUnavailable,
    completeBreaker: rejectUnavailable,
  });
}
