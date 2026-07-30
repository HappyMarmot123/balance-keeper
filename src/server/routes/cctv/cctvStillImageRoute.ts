import { type CctvBounds, type CctvCameraId, cctvCameraIdSchema } from '../../../entities/cctv/contract';
import { AppError } from '../../../shared/contracts';
import {
  createRouteProfile,
  type GatewayMediaRoute,
  type OpaqueAdmissionSubject,
  rethrowAsUpstreamUnavailable,
} from '../../gateway';
import { fetchItsCctvStillImage, fetchItsCctvStillMetadataById, ItsCctvCameraNotFoundError } from '../../providers/its';
import { parseCctvBounds } from './cctvRequest';

const CCTV_SOURCE = 'ITS 국가교통정보센터';

export type CctvStillImageRouteInput = Readonly<{
  bounds: CctvBounds;
  cameraId: CctvCameraId;
}>;

export type CreateCctvStillImageRouteOptions = Readonly<{
  clock?: () => number;
  fetcher?: typeof fetch;
  readAdmissionSubject: (request: Request) => OpaqueAdmissionSubject;
  serviceKey?: string;
}>;

export const CCTV_STILL_IMAGE_ROUTE_PROFILE = createRouteProfile({
  freshForMs: 1,
  staleIfErrorForMs: 1,
  negativeForMs: false,
  upstreamTimeoutMs: 8_000,
  lockWaitMs: 1,
  lockPollMs: 1,
  lockSafetyMs: 1_000,
  admissionRate: { limit: 6, windowMs: 60_000, scope: 'route.cctv-image' },
  upstreamBudget: {
    limit: 60,
    windowMs: 24 * 60 * 60_000,
    scope: 'provider.its-cctv-still',
  },
  breaker: {
    scope: 'provider.its-cctv-still',
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    probeTimeoutMs: 5_000,
  },
  cdnMaxAgeSeconds: 1,
});

const assertClock = (epochMs: number): void => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError('CCTV still-image route clock must return a non-negative safe epoch millisecond value');
  }
};

export function createCctvStillImageRoute(
  options: CreateCctvStillImageRouteOptions,
): GatewayMediaRoute<CctvStillImageRouteInput, CctvStillImageRouteInput> {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? globalThis.fetch;

  return {
    kind: 'media',
    id: 'cctv-image',
    path: '/api/cctv/image',
    profile: CCTV_STILL_IMAGE_ROUTE_PROFILE,
    parseRequest(request) {
      if (request.headers.has('Range')) {
        throw new AppError('BAD_REQUEST');
      }
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

      let metadata: Awaited<ReturnType<typeof fetchItsCctvStillMetadataById>>;
      try {
        metadata = await fetchItsCctvStillMetadataById({
          bounds: input.bounds,
          cameraId: input.cameraId,
          fetcher,
          serviceKey,
          signal,
        });
      } catch (error) {
        if (error instanceof ItsCctvCameraNotFoundError) {
          throw new AppError('NOT_FOUND');
        }
        rethrowAsUpstreamUnavailable(error, signal);
      }

      let image: Awaited<ReturnType<typeof fetchItsCctvStillImage>>;
      try {
        image = await fetchItsCctvStillImage({
          fetcher,
          signal,
          url: metadata.url,
        });
      } catch (error) {
        rethrowAsUpstreamUnavailable(error, signal);
      }

      const fetchedAt = clock();
      assertClock(fetchedAt);
      return {
        body: image.bytes,
        contentType: 'image/jpeg',
        fetchedAt,
        kind: 'media',
        source: CCTV_SOURCE,
      };
    },
  };
}
