import type { HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from 'hls.js';

import { isSafeCctvHlsTransportUrl } from '../../../entities/cctv';

const BOUNDARY_REJECTION = Object.freeze({
  code: 0,
  text: 'CCTV media boundary rejected',
});

const createFailClosedRequest: NonNullable<HlsConfig['fetchSetup']> = (context, initParams) =>
  new Request(context.url, {
    ...initParams,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });

type PendingProgress = Readonly<{
  context: LoaderContext;
  data: string | ArrayBuffer;
  networkDetails: unknown;
  stats: LoaderStats;
}>;

type ExtendedLoaderContext = LoaderContext &
  Readonly<{
    frag?: Readonly<{ sn?: unknown }>;
    keyInfo?: unknown;
  }>;

const isSafeContext = (context: LoaderContext): boolean => {
  const extendedContext = context as ExtendedLoaderContext;
  const hasByteRange = (context.rangeStart ?? 0) !== 0 || (context.rangeEnd ?? 0) !== 0;
  const hasRangeHeader = Object.keys(context.headers ?? {}).some((name) => name.toLowerCase() === 'range');
  return (
    !hasByteRange &&
    !hasRangeHeader &&
    extendedContext.frag?.sn !== 'initSegment' &&
    !Object.hasOwn(extendedContext, 'keyInfo') &&
    context.progressData !== true &&
    isSafeCctvHlsTransportUrl(context.url)
  );
};

const getNetworkResponseUrl = (networkDetails: unknown): string | undefined => {
  if (networkDetails === null || typeof networkDetails !== 'object') {
    return undefined;
  }
  if ('url' in networkDetails && typeof networkDetails.url === 'string') {
    return networkDetails.url;
  }
  if ('responseURL' in networkDetails && typeof networkDetails.responseURL === 'string') {
    return networkDetails.responseURL;
  }
  return undefined;
};

export function createCctvHlsBoundaryLoader(BaseLoader: HlsConfig['loader']): HlsConfig['loader'] {
  return class CctvHlsBoundaryLoader implements Loader<LoaderContext> {
    readonly delegate: Loader<LoaderContext>;
    context: LoaderContext | null = null;

    constructor(config: HlsConfig) {
      this.delegate = new BaseLoader({
        ...config,
        fetchSetup: createFailClosedRequest,
        progressive: false,
      });
    }

    get stats(): LoaderStats {
      return this.delegate.stats;
    }

    abort(): void {
      this.delegate.abort();
    }

    destroy(): void {
      this.delegate.destroy();
      this.context = null;
    }

    getCacheAge(): number | null {
      return this.delegate.getCacheAge?.() ?? null;
    }

    getResponseHeader(name: string): string | null {
      return this.delegate.getResponseHeader?.(name) ?? null;
    }

    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
      this.context = context;
      if (!isSafeContext(context)) {
        callbacks.onError(BOUNDARY_REJECTION, context, null, this.stats);
        return;
      }

      let pendingProgress: PendingProgress[] = [];
      let terminal = false;
      const guardedCallbacks: LoaderCallbacks<LoaderContext> = {
        onAbort: (stats, returnedContext, networkDetails) => {
          pendingProgress = [];
          if (terminal) {
            return;
          }
          terminal = true;
          callbacks.onAbort?.(stats, returnedContext, networkDetails);
        },
        onError: (error, returnedContext, networkDetails, stats) => {
          pendingProgress = [];
          if (terminal) {
            return;
          }
          terminal = true;
          callbacks.onError(error, returnedContext, networkDetails, stats);
        },
        onSuccess: (response, stats, returnedContext, networkDetails) => {
          if (terminal) {
            return;
          }
          const networkResponseUrl = getNetworkResponseUrl(networkDetails);
          if (
            !isSafeCctvHlsTransportUrl(response.url) ||
            (networkResponseUrl !== undefined &&
              (networkResponseUrl !== response.url || !isSafeCctvHlsTransportUrl(networkResponseUrl)))
          ) {
            pendingProgress = [];
            terminal = true;
            this.delegate.abort();
            callbacks.onError(BOUNDARY_REJECTION, returnedContext, null, stats);
            return;
          }

          terminal = true;
          for (const progress of pendingProgress) {
            callbacks.onProgress?.(progress.stats, progress.context, progress.data, progress.networkDetails);
          }
          pendingProgress = [];
          callbacks.onSuccess(response, stats, returnedContext, networkDetails);
        },
        onTimeout: (stats, returnedContext, networkDetails) => {
          pendingProgress = [];
          if (terminal) {
            return;
          }
          terminal = true;
          callbacks.onTimeout(stats, returnedContext, networkDetails);
        },
      };
      if (callbacks.onProgress !== undefined) {
        guardedCallbacks.onProgress = (stats, returnedContext, data, networkDetails) => {
          if (terminal) {
            return;
          }
          pendingProgress.push({ context: returnedContext, data, networkDetails, stats });
        };
      }
      this.delegate.load(context, config, guardedCallbacks);
    }
  };
}
