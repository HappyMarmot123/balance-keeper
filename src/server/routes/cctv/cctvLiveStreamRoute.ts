import {
  type CctvBounds,
  type CctvCameraId,
  cctvCameraIdSchema,
  cctvLiveSourceSchema,
} from '../../../entities/cctv/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayNoStoreRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import {
  fetchItsCctvLiveMetadataById,
  ItsCctvCameraNotFoundError,
  resolveItsCctvLiveManifestUrl,
} from '../../providers/its';
import { parseCctvBounds } from './cctvRequest';

const CCTV_SOURCE = 'ITS 국가교통정보센터';

export type CctvLiveStreamRouteInput = Readonly<{
  bounds: CctvBounds;
  cameraId: CctvCameraId;
}>;

export type CreateCctvLiveStreamRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const CCTV_LIVE_STREAM_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 1,
  staleIfErrorForMs: 1,
  negativeForMs: false,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 1,
  lockPollMs: 1,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 12, windowMs: 60_000, scope: 'route.cctv-stream' },
  upstreamBudget: {
    limit: 200,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-cctv',
  },
  breaker: {
    scope: 'provider.its-cctv',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 1,
});

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('CCTV live-stream route clock must return a non-negative safe epoch millisecond value');
  }
};

export function createCctvLiveStreamRoute(
  options: CreateCctvLiveStreamRouteOptions,
): GatewayNoStoreRoute<CctvLiveStreamRouteInput, CctvLiveStreamRouteInput, typeof cctvLiveSourceSchema> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    kind: 'no-store',
    dataSchema: cctvLiveSourceSchema,
    id: 'cctv-stream',
    path: '/api/cctv/stream',
    profile: CCTV_LIVE_STREAM_ROUTE_PROFILE,
    parseRequest(request) {
      const search = new URL(request.url).searchParams;
      for (const key of search.keys()) {
        if (key !== 'cameraId' && key !== 'bbox') {
          throw new AppError('BAD_REQUEST');
        }
      }
      const cameraIdValues = search.getAll('cameraId');
      const bboxValues = search.getAll('bbox');
      if (cameraIdValues.length !== 1 || bboxValues.length !== 1) {
        throw new AppError('BAD_REQUEST');
      }
      const cameraId = cctvCameraIdSchema.safeParse(cameraIdValues[0]);
      if (!cameraId.success) {
        throw new AppError('BAD_REQUEST');
      }
      const input = Object.freeze({
        bounds: parseCctvBounds(bboxValues[0] ?? ''),
        cameraId: cameraId.data,
      });
      return {
        admissionSubject: options.readAdmissionSubject(request),
        input,
        publicCacheIdentity: input,
      };
    },
    async load(input, signal) {
      const serviceKey = options.serviceKey?.trim();
      if (serviceKey === undefined || serviceKey.length === 0) {
        throw new AppError('MISSING_CREDENTIALS');
      }

      let manifestUrl: string;
      try {
        const metadata = await fetchItsCctvLiveMetadataById({
          bounds: input.bounds,
          cameraId: input.cameraId,
          fetcher,
          serviceKey,
          signal,
        });
        manifestUrl = await resolveItsCctvLiveManifestUrl({
          fetcher,
          initialUrl: metadata.url,
          signal,
        });
      } catch (error) {
        if (error instanceof ItsCctvCameraNotFoundError) {
          throw new AppError('NOT_FOUND');
        }
        rethrowAsUpstreamUnavailable(error, signal);
      }

      const fetchedAt = clock();
      assertClock(fetchedAt);
      return {
        data: { url: manifestUrl },
        fetchedAt,
        kind: 'value',
        source: CCTV_SOURCE,
      };
    },
  };
}
