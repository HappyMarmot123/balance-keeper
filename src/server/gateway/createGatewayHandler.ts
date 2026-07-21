import { AppError, isAppError } from '../../shared/contracts';
import {
  type AllowedBreakerPermit,
  type CacheRecord,
  canonicalJson,
  classifyCacheRecord,
  createCacheKey,
  createCacheRecordSchema,
  createStateKey,
  createWeakEtag,
  type FixedWindowConsumption,
  type FleetStateStore,
} from '../cache';
import { createApiResponse, type JsonBodyStatus, type JsonValue, toErrorEnvelope, toSuccessEnvelope } from '../http';
import { type GatewayLogger, safeLog } from '../observability';
import {
  GatewayTimeoutError,
  type LocalCoalescer,
  type PollUntilOptions,
  pollUntil,
  type Scheduler,
  withTimeout,
} from '../resilience';
import type { GatewayRoute, ParsedGatewayRequest, UpstreamOutcome } from './route';
import { deriveBreakerPolicy } from './routeProfile';
import type { RouteRegistry } from './routeRegistry';

export type GatewayDependencies = Readonly<{
  clock: () => number;
  createCoordinationToken: () => string;
  createRequestId: () => string;
  fleetStateStore: FleetStateStore;
  localCoalescer: LocalCoalescer<string>;
  logger?: GatewayLogger;
  scheduler?: Scheduler;
  sleep?: PollUntilOptions['sleep'];
}>;

export type GatewayHandler = (request: Request, dependencies: GatewayDependencies) => Promise<Response>;

type AcquiredRepresentation = Readonly<{
  cacheStatus: 'HIT' | 'MISS' | 'STALE';
  degraded: boolean;
  record: CacheRecord<unknown>;
}>;

type ErrorLogContext = Readonly<{
  dependencies: GatewayDependencies;
  route: string;
  startedAt: number;
}>;

type AcquisitionLogContext = Readonly<{
  requestId: string;
  startedAt: number;
}>;

type DegradedPhase = 'breaker-acquire' | 'breaker-complete' | 'cache-delete' | 'cache-write' | 'lease-release';

const createErrorResponse = (
  error: unknown,
  requestId: string,
  retryAfterMs?: number,
  logContext?: ErrorLogContext,
): Response => {
  const serialized = toErrorEnvelope(error, requestId);
  const response = createApiResponse({
    body: serialized.envelope as JsonValue,
    cache: 'no-store',
    requestId,
    ...(retryAfterMs === undefined ? {} : { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)) }),
    status: serialized.status as JsonBodyStatus,
  });

  if (logContext !== undefined) {
    safeLog(logContext.dependencies.logger, {
      event: 'gateway.request',
      route: logContext.route,
      phase: 'response',
      outcome: 'error',
      durationMs: durationSince(logContext.dependencies.clock, logContext.startedAt),
      requestId,
      errorCode: serialized.envelope.error.code,
    });
  }

  return response;
};

const currentTime = (clock: () => number): number => {
  const now = clock();

  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError('Gateway clock must return non-negative safe epoch milliseconds');
  }

  return now;
};

const addDuration = (epochMs: number, durationMs: number): number => {
  const result = epochMs + durationMs;

  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Gateway policy exceeds the safe epoch millisecond range');
  }

  return result;
};

const isTransientUpstreamFailure = (error: unknown): boolean =>
  error instanceof GatewayTimeoutError || (isAppError(error) && error.code === 'UPSTREAM_UNAVAILABLE');

const readLogTime = (clock: () => number): number => {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

const durationSince = (clock: () => number, startedAt: number): number =>
  Math.max(0, Math.round(readLogTime(clock) - startedAt));

const logDegraded = (
  dependencies: GatewayDependencies,
  route: GatewayRoute,
  context: AcquisitionLogContext,
  phase: DegradedPhase,
): void => {
  safeLog(dependencies.logger, {
    event: 'gateway.degraded',
    route: route.id,
    phase,
    outcome: 'failure',
    durationMs: durationSince(dependencies.clock, context.startedAt),
    requestId: context.requestId,
  });
};

const runBestEffort = async (
  operation: () => Promise<boolean>,
  dependencies: GatewayDependencies,
  route: GatewayRoute,
  context: AcquisitionLogContext,
  phase: DegradedPhase,
): Promise<boolean> => {
  try {
    const completed = await operation();

    if (!completed) {
      logDegraded(dependencies, route, context, phase);
    }

    return completed;
  } catch {
    logDegraded(dependencies, route, context, phase);
    return false;
  }
};

const throwIfRequestAborted = (request: Request): void => {
  if (request.signal.aborted) {
    throw request.signal.reason;
  }
};

type StableJsonParse = Readonly<{ success: true; data: unknown }> | Readonly<{ success: false }>;

const parseStableJsonData = (route: GatewayRoute, input: unknown): StableJsonParse => {
  let inputCanonical: string;

  try {
    inputCanonical = canonicalJson(input);
  } catch {
    return { success: false };
  }

  const parsed = route.dataSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false };
  }

  try {
    return canonicalJson(parsed.data) === inputCanonical ? { success: true, data: parsed.data } : { success: false };
  } catch {
    return { success: false };
  }
};

const readUsableCache = async (
  route: GatewayRoute,
  cacheKey: string,
  dependencies: GatewayDependencies,
): Promise<AcquiredRepresentation | undefined> => {
  let rawRecord: unknown | null;

  try {
    rawRecord = await dependencies.fleetStateStore.readCache(cacheKey);
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE');
  }

  if (rawRecord === null) {
    return undefined;
  }

  const rawData =
    typeof rawRecord === 'object' && rawRecord !== null && 'data' in rawRecord
      ? (rawRecord as { data: unknown }).data
      : undefined;
  const stableData = parseStableJsonData(route, rawData);

  if (!stableData.success) {
    return undefined;
  }

  const classification = classifyCacheRecord(
    createCacheRecordSchema(route.dataSchema),
    rawRecord,
    currentTime(dependencies.clock),
  );

  if (classification.state === 'invalid' || classification.state === 'expired') {
    return undefined;
  }

  return {
    cacheStatus: classification.state === 'fresh' ? 'HIT' : 'STALE',
    degraded: classification.state === 'stale',
    record: classification.record,
  };
};

const retainStaleCandidate = (
  route: GatewayRoute,
  candidate: AcquiredRepresentation | undefined,
  dependencies: GatewayDependencies,
): AcquiredRepresentation | undefined => {
  if (candidate?.cacheStatus !== 'STALE') {
    return undefined;
  }

  const classification = classifyCacheRecord(
    createCacheRecordSchema(route.dataSchema),
    candidate.record,
    currentTime(dependencies.clock),
  );

  return classification.state === 'stale' ? candidate : undefined;
};

const canUseStaleForAcquisitionError = (error: unknown): boolean =>
  isAppError(error) && (error.code === 'UPSTREAM_UNAVAILABLE' || error.code === 'SERVICE_UNAVAILABLE');

const assertUpstreamOutcome = (route: GatewayRoute, input: UpstreamOutcome<unknown>): UpstreamOutcome<unknown> => {
  if (
    typeof input !== 'object' ||
    input === null ||
    (input.kind !== 'value' && input.kind !== 'empty') ||
    typeof input.source !== 'string' ||
    input.source.length === 0 ||
    !Number.isSafeInteger(input.fetchedAt) ||
    input.fetchedAt < 0
  ) {
    throw new AppError('UPSTREAM_UNAVAILABLE');
  }

  const parsedData = parseStableJsonData(route, input.data);

  if (!parsedData.success) {
    throw new AppError('UPSTREAM_UNAVAILABLE');
  }

  return { ...input, data: parsedData.data };
};

const createRecord = (
  route: GatewayRoute,
  outcome: UpstreamOutcome<unknown>,
  storedAt: number,
): CacheRecord<unknown> => {
  const freshForMs = outcome.kind === 'empty' ? route.profile.negativeForMs : route.profile.freshForMs;
  const freshUntil = freshForMs === false ? storedAt : addDuration(storedAt, freshForMs);
  const common = {
    version: 1 as const,
    data: outcome.data,
    source: outcome.source,
    fetchedAt: outcome.fetchedAt,
    storedAt,
    freshUntil,
  };

  return outcome.kind === 'value'
    ? {
        ...common,
        kind: 'positive',
        staleUntil: addDuration(freshUntil, route.profile.staleIfErrorForMs),
      }
    : { ...common, kind: 'negative' };
};

const responseForRepresentation = (
  route: GatewayRoute,
  representation: AcquiredRepresentation,
  request: Request,
  requestId: string,
): Response => {
  const { record } = representation;
  const outcomeKind = record.kind === 'positive' ? 'value' : 'empty';
  const envelope = toSuccessEnvelope(route.dataSchema, record.data, {
    cache: representation.cacheStatus,
    fetchedAt: record.fetchedAt,
    requestId,
    source: record.source,
  });
  const etag = createWeakEtag({
    data: record.data,
    degraded: representation.degraded,
    fetchedAt: record.fetchedAt,
    kind: outcomeKind,
    source: record.source,
  });

  if (representation.degraded) {
    return createApiResponse({
      body: envelope as JsonValue,
      cache: 'no-store',
      etag,
      requestId,
      status: 200,
    });
  }

  return createApiResponse({
    body: envelope as JsonValue,
    cache: 'current',
    etag,
    ifNoneMatch: request.headers.get('If-None-Match'),
    requestId,
    status: 200,
  });
};

const acquireRepresentation = async (
  route: GatewayRoute,
  parsedRequest: ParsedGatewayRequest<unknown>,
  cacheKey: string,
  dependencies: GatewayDependencies,
  logContext: AcquisitionLogContext,
): Promise<AcquiredRepresentation> => {
  const cached = await readUsableCache(route, cacheKey, dependencies);

  if (cached?.cacheStatus === 'HIT') {
    return cached;
  }

  const leaseKey = createStateKey('lease', `route.${route.id}`, parsedRequest.publicCacheIdentity);
  const leaseToken = dependencies.createCoordinationToken();
  const leaseTtlMs = route.profile.upstreamTimeoutMs + route.profile.lockSafetyMs;
  let ownsLease: boolean;

  try {
    ownsLease = await dependencies.fleetStateStore.tryAcquireLease(leaseKey, leaseToken, leaseTtlMs);
  } catch {
    const retainedStale = retainStaleCandidate(route, cached, dependencies);
    if (retainedStale !== undefined) {
      return retainedStale;
    }

    throw new AppError('SERVICE_UNAVAILABLE');
  }

  if (!ownsLease) {
    const retainedStale = retainStaleCandidate(route, cached, dependencies);
    if (retainedStale !== undefined) {
      return retainedStale;
    }

    const populated = await pollUntil(
      async () => {
        const candidate = await readUsableCache(route, cacheKey, dependencies);
        return candidate?.cacheStatus === 'HIT' ? candidate : undefined;
      },
      {
        clock: dependencies.clock,
        intervalMs: route.profile.lockPollMs,
        ...(dependencies.scheduler === undefined ? {} : { scheduler: dependencies.scheduler }),
        ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
        timeoutMs: route.profile.lockWaitMs,
      },
    );

    if (populated !== undefined) {
      return populated;
    }

    throw new AppError('SERVICE_UNAVAILABLE');
  }

  try {
    let refreshedCache: AcquiredRepresentation | undefined;

    try {
      refreshedCache = await readUsableCache(route, cacheKey, dependencies);
    } catch (error) {
      const retainedStale = retainStaleCandidate(route, cached, dependencies);
      if (retainedStale !== undefined) {
        return retainedStale;
      }

      throw error;
    }

    const staleCandidate =
      refreshedCache?.cacheStatus === 'STALE' ? refreshedCache : cached?.cacheStatus === 'STALE' ? cached : undefined;

    if (refreshedCache?.cacheStatus === 'HIT') {
      return refreshedCache;
    }

    const breakerKey = createStateKey('breaker', route.profile.breaker.scope);
    const breakerPolicy = deriveBreakerPolicy(route.profile);
    let breakerPermit: AllowedBreakerPermit | undefined;

    try {
      const permit = await dependencies.fleetStateStore.acquireBreaker(
        breakerKey,
        dependencies.createCoordinationToken(),
        breakerPolicy,
      );

      if (!permit.allowed) {
        const retainedStale = retainStaleCandidate(route, staleCandidate, dependencies);
        if (retainedStale !== undefined) {
          return retainedStale;
        }

        throw new AppError('SERVICE_UNAVAILABLE');
      }

      breakerPermit = permit;
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }

      logDegraded(dependencies, route, logContext, 'breaker-acquire');
    }

    const upstreamBudgetKey = createStateKey('rate', route.profile.upstreamBudget.scope);
    let upstreamBudget: FixedWindowConsumption;

    try {
      upstreamBudget = await dependencies.fleetStateStore.consumeFixedWindow(
        upstreamBudgetKey,
        route.profile.upstreamBudget,
      );
    } catch {
      if (breakerPermit !== undefined) {
        await runBestEffort(
          () => dependencies.fleetStateStore.completeBreaker(breakerKey, breakerPermit, 'NEUTRAL', breakerPolicy),
          dependencies,
          route,
          logContext,
          'breaker-complete',
        );
      }

      const retainedStale = retainStaleCandidate(route, staleCandidate, dependencies);
      if (retainedStale !== undefined) {
        return retainedStale;
      }

      throw new AppError('SERVICE_UNAVAILABLE');
    }

    if (!upstreamBudget.allowed) {
      if (breakerPermit !== undefined) {
        await runBestEffort(
          () => dependencies.fleetStateStore.completeBreaker(breakerKey, breakerPermit, 'NEUTRAL', breakerPolicy),
          dependencies,
          route,
          logContext,
          'breaker-complete',
        );
      }

      const retainedStale = retainStaleCandidate(route, staleCandidate, dependencies);
      if (retainedStale !== undefined) {
        return retainedStale;
      }

      throw new AppError('SERVICE_UNAVAILABLE');
    }

    try {
      const timeoutMs =
        breakerPermit?.state === 'HALF_OPEN'
          ? Math.min(route.profile.upstreamTimeoutMs, route.profile.breaker.probeTimeoutMs)
          : route.profile.upstreamTimeoutMs;
      const outcome = assertUpstreamOutcome(
        route,
        await withTimeout((signal) => route.load(parsedRequest.input, signal), {
          ...(dependencies.scheduler === undefined ? {} : { scheduler: dependencies.scheduler }),
          timeoutMs,
        }),
      );
      const storedAt = currentTime(dependencies.clock);
      const record = createRecord(route, outcome, storedAt);
      const expiresAt = record.kind === 'positive' ? record.staleUntil : record.freshUntil;

      if (expiresAt > storedAt) {
        await runBestEffort(
          () =>
            dependencies.fleetStateStore.writeCacheIfLeaseOwner({
              cacheKey,
              leaseKey,
              leaseToken,
              ttlMs: expiresAt - storedAt,
              value: record,
            }),
          dependencies,
          route,
          logContext,
          'cache-write',
        );
      } else {
        await runBestEffort(
          () => dependencies.fleetStateStore.deleteCacheIfLeaseOwner({ cacheKey, leaseKey, leaseToken }),
          dependencies,
          route,
          logContext,
          'cache-delete',
        );
      }
      if (breakerPermit !== undefined) {
        await runBestEffort(
          () => dependencies.fleetStateStore.completeBreaker(breakerKey, breakerPermit, 'SUCCESS', breakerPolicy),
          dependencies,
          route,
          logContext,
          'breaker-complete',
        );
      }

      return { cacheStatus: 'MISS', degraded: false, record };
    } catch (error) {
      const transient = isTransientUpstreamFailure(error);
      if (breakerPermit !== undefined) {
        await runBestEffort(
          () =>
            dependencies.fleetStateStore.completeBreaker(
              breakerKey,
              breakerPermit,
              transient ? 'FAILURE' : 'NEUTRAL',
              breakerPolicy,
            ),
          dependencies,
          route,
          logContext,
          'breaker-complete',
        );
      }

      const retainedStale = transient ? retainStaleCandidate(route, staleCandidate, dependencies) : undefined;
      if (retainedStale !== undefined) {
        return retainedStale;
      }

      if (transient) {
        throw new AppError('UPSTREAM_UNAVAILABLE');
      }

      throw error;
    }
  } finally {
    await runBestEffort(
      () => dependencies.fleetStateStore.releaseLease(leaseKey, leaseToken),
      dependencies,
      route,
      logContext,
      'lease-release',
    );
  }
};

export function createGatewayHandler(registry: RouteRegistry): GatewayHandler {
  return async (request, dependencies) => {
    throwIfRequestAborted(request);
    const startedAt = readLogTime(dependencies.clock);
    const requestId = dependencies.createRequestId();
    const pathname = new URL(request.url).pathname;
    const route = registry.getByPath(pathname);

    if (request.method !== 'GET' || route === undefined) {
      return createErrorResponse(new AppError('NOT_FOUND'), requestId, undefined, {
        dependencies,
        route: 'unmatched',
        startedAt,
      });
    }

    try {
      const parsedRequest = await route.parseRequest(request);
      throwIfRequestAborted(request);
      const admissionKey = createStateKey('rate', route.profile.admissionRate.scope, parsedRequest.admissionSubject);
      const admission = await dependencies.fleetStateStore
        .consumeFixedWindow(admissionKey, route.profile.admissionRate)
        .catch(() => {
          throw new AppError('SERVICE_UNAVAILABLE');
        });
      throwIfRequestAborted(request);

      if (!admission.allowed) {
        return createErrorResponse(new AppError('RATE_LIMITED'), requestId, admission.retryAfterMs, {
          dependencies,
          route: route.id,
          startedAt,
        });
      }

      throwIfRequestAborted(request);
      const cacheKey = createCacheKey(route.id, parsedRequest.publicCacheIdentity);
      const cached = await readUsableCache(route, cacheKey, dependencies);
      throwIfRequestAborted(request);
      let representation: AcquiredRepresentation;

      if (cached?.cacheStatus === 'HIT') {
        representation = cached;
      } else {
        try {
          representation = await dependencies.localCoalescer.run(
            cacheKey,
            () => acquireRepresentation(route, parsedRequest, cacheKey, dependencies, { requestId, startedAt }),
            request.signal,
          );
        } catch (error) {
          const retainedStale = canUseStaleForAcquisitionError(error)
            ? retainStaleCandidate(route, cached, dependencies)
            : undefined;

          if (retainedStale === undefined) {
            throw error;
          }

          representation = retainedStale;
        }
      }

      throwIfRequestAborted(request);
      const response = responseForRepresentation(route, representation, request, requestId);
      safeLog(dependencies.logger, {
        event: 'gateway.request',
        route: route.id,
        phase: 'response',
        outcome: 'success',
        durationMs: durationSince(dependencies.clock, startedAt),
        requestId,
        cacheStatus: representation.cacheStatus,
      });
      return response;
    } catch (error) {
      if (request.signal.aborted) {
        throw request.signal.reason;
      }

      return createErrorResponse(error, requestId, undefined, {
        dependencies,
        route: route.id,
        startedAt,
      });
    }
  };
}
