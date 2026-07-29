import { newsDataSchema, PUBLIC_PRESS_SOURCES, type PublicPressSourceStatus } from '../../../entities/news/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchPublicPressFeed, PUBLIC_PRESS_FEEDS } from '../../providers/public-press';
import { withTimeout } from '../../resilience';

const NEWS_SOURCE = '문화체육관광부 · 행정안전부 · 공공누리 제1유형';
const DEFAULT_FEED_TIMEOUT_MS = 5_000;

export type CreateNewsRouteOptions = Readonly<{
  clock?: () => number;
  feedTimeoutMs?: number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
}>;

export const NEWS_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 10 * 60_000,
  staleIfErrorForMs: 6 * 60 * 60_000,
  negativeForMs: 5 * 60_000,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 2_000,
  lockPollMs: 50,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 120, windowMs: 60_000, scope: 'route.news' },
  upstreamBudget: {
    limit: 180,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.public-press',
  },
  breaker: {
    scope: 'provider.public-press',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 5 * 60,
});

type NewsRouteInput = Readonly<Record<string, never>>;

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < Date.UTC(2020, 0, 1)) {
    throw new RangeError('News route clock must return a supported safe epoch millisecond value');
  }
};

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const compareItems = (
  left: Readonly<{ id: string; publishedAt: number; sourceId: string }>,
  right: Readonly<{ id: string; publishedAt: number; sourceId: string }>,
): number =>
  right.publishedAt - left.publishedAt ||
  left.sourceId.localeCompare(right.sourceId) ||
  left.id.localeCompare(right.id);

export function createNewsRoute(
  options: CreateNewsRouteOptions,
): GatewayRoute<NewsRouteInput, Readonly<{ scope: 'korea-public-press' }>, typeof newsDataSchema> {
  const clock = options.clock ?? Date.now;
  const feedTimeoutMs = options.feedTimeoutMs ?? DEFAULT_FEED_TIMEOUT_MS;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    id: 'news',
    path: '/api/news',
    dataSchema: newsDataSchema,
    profile: NEWS_ROUTE_PROFILE,
    parseRequest(request: Request) {
      if (new URL(request.url).search.length > 0) {
        throw new AppError('BAD_REQUEST');
      }

      return {
        admissionSubject: options.readAdmissionSubject(request),
        input: {},
        publicCacheIdentity: { scope: 'korea-public-press' },
      };
    },
    async load(_input, signal) {
      if (signal.aborted) {
        throwAbortReason(signal);
      }

      const attempts = PUBLIC_PRESS_FEEDS.map((definition) =>
        withTimeout(
          (feedSignal) =>
            fetchPublicPressFeed({
              definition,
              fetcher,
              signal: feedSignal,
            }),
          {
            parentSignal: signal,
            timeoutMs: feedTimeoutMs,
          },
        ).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (error: unknown) => ({ error, status: 'rejected' as const }),
        ),
      );
      const results = await Promise.all(attempts);

      if (signal.aborted) {
        throwAbortReason(signal);
      }
      if (results.every((result) => result.status === 'rejected')) {
        rethrowAsUpstreamUnavailable(new Error('No public press feed succeeded'), signal);
      }

      const createSource = (index: 0 | 1) => {
        const source = PUBLIC_PRESS_SOURCES[index];
        const feed = PUBLIC_PRESS_FEEDS[index];
        const result = results[index];
        if (source === undefined || feed === undefined || result === undefined || feed.id !== source.id) {
          throw new RangeError('Public press source order is invalid');
        }
        const status: PublicPressSourceStatus =
          result.status === 'rejected' ? 'unavailable' : result.value.items.length === 0 ? 'empty' : 'available';
        return { ...source, status };
      };

      const sortedItems = results
        .flatMap((result) => (result.status === 'fulfilled' ? result.value.items : []))
        .sort(compareItems);
      const seenIds = new Set<string>();
      const seenUrls = new Set<string>();
      const items = sortedItems
        .filter((item) => {
          if (seenIds.has(item.id) || seenUrls.has(item.originalUrl)) {
            return false;
          }
          seenIds.add(item.id);
          seenUrls.add(item.originalUrl);
          return true;
        })
        .slice(0, 12);
      const sources = [createSource(0), createSource(1)] as const;
      const data = newsDataSchema.parse({ items, sources });
      const fetchedAt = clock();
      assertClock(fetchedAt);

      return {
        kind: data.sources.every((source) => source.status === 'empty') ? 'empty' : 'value',
        data,
        fetchedAt,
        source: NEWS_SOURCE,
      };
    },
  };
}
