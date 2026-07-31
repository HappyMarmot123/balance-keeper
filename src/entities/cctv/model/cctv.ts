import { z } from 'zod';

const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

export const CCTV_KOREA_BOUNDS = Object.freeze({
  maximumLatitude: 39,
  maximumLongitude: 132,
  minimumLatitude: 33,
  minimumLongitude: 124,
});

export const CCTV_MAX_BBOX_SPAN_DEGREES = 1;
export const CCTV_CAMERA_LIMIT = 2_000;
export const CCTV_SNAPSHOT_MAX_BYTES = 3 * 1_024 * 1_024;

export const cctvRoadTypeSchema = z.enum(['expressway', 'national-road']);
export const cctvCameraIdSchema = z.string().regex(/^its-cctv:[A-Za-z0-9_-]{16,43}$/u);

const nullableCreatedAtSchema = z.number().int().nonnegative().max(MAX_DATE_EPOCH_MS).nullable();
const nullableResolutionSchema = z.string().trim().min(1).max(100).nullable();
const LIVE_MEDIA_PATH_PATTERN = /^\/\d{1,5}\/(?:[A-Za-z0-9+/]{86}==|[A-Za-z0-9+/]{107}=)$/u;
const STILL_MEDIA_PATH_PATTERN = /^\/\d{1,5}\/[A-Za-z0-9+/]{86}==$/u;
const HLS_TRANSPORT_HOSTNAME = 'cctvsec.ktict.co.kr';
const HLS_TRANSPORT_PORT = '8082';
const HLS_TRANSPORT_PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+\.(?:m3u8|ts)$/u;
const UNSAFE_HLS_PATH_PATTERN = /(?:\\|\/\/|(?:^|\/)\.{1,2}(?:\/|$))/u;
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

export const isSafeCctvMediaPath = (value: string, kind: 'live-hls' | 'still-image'): boolean => {
  const authorityEnd = value.indexOf('/', 'https://'.length);
  const rawPath = authorityEnd === -1 ? '' : value.slice(authorityEnd);
  return (kind === 'live-hls' ? LIVE_MEDIA_PATH_PATTERN : STILL_MEDIA_PATH_PATTERN).test(rawPath);
};

const isSafeCctvMediaUrl = (value: string, kind: 'live-hls' | 'still-image'): boolean => {
  if (value.length > 2_048 || !isSafeCctvMediaPath(value, kind)) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== HLS_TRANSPORT_HOSTNAME ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname === '/'
  ) {
    return false;
  }
  return kind === 'still-image' ? url.port === '8091' : url.port === '';
};

export const isSafeCctvInitialHlsUrl = (value: string): boolean => isSafeCctvMediaUrl(value, 'live-hls');

const createMediaUrlSchema = (kind: 'live-hls' | 'still-image') =>
  z
    .string()
    .url()
    .max(2_048)
    .refine(
      (value) => isSafeCctvMediaUrl(value, kind),
      `CCTV ${kind} URL must match the approved HTTPS media boundary`,
    );

const createCctvMediaSourceSchema = (kind: 'live-hls' | 'still-image') =>
  z
    .object({
      createdAt: nullableCreatedAtSchema,
      resolution: nullableResolutionSchema,
      url: createMediaUrlSchema(kind),
    })
    .strict();

const isSafeCctvHlsDerivedUrl = (value: string): boolean => {
  if (value.length > 2_048) {
    return false;
  }

  const authorityEnd = value.indexOf('/', 'https://'.length);
  const queryStart = value.indexOf('?', authorityEnd);
  const rawPath = authorityEnd === -1 ? '' : value.slice(authorityEnd, queryStart === -1 ? undefined : queryStart);
  if (!HLS_TRANSPORT_PATH_PATTERN.test(rawPath) || UNSAFE_HLS_PATH_PATTERN.test(rawPath) || value.includes('#')) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== HLS_TRANSPORT_HOSTNAME ||
    url.port !== HLS_TRANSPORT_PORT ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    return false;
  }

  const queryEntries = [...url.searchParams.entries()];
  const queryKeys = queryEntries.map(([key]) => key);
  if (
    queryEntries.some(
      ([, queryValue]) => queryValue.length === 0 || queryValue.length > 512 || hasControlCharacter(queryValue),
    ) ||
    new Set(queryKeys).size !== queryKeys.length
  ) {
    return false;
  }

  const sortedKeys = [...queryKeys].sort().join(',');
  if (url.pathname.endsWith('.ts')) {
    return sortedKeys === 'nimblesessionid,wmsAuthSign';
  }
  return sortedKeys === 'wmsAuthSign' || sortedKeys === 'nimblesessionid,wmsAuthSign';
};

export const isSafeCctvHlsTransportUrl = (value: string): boolean => isSafeCctvHlsDerivedUrl(value);
export const isSafeCctvHlsManifestUrl = (value: string): boolean =>
  isSafeCctvHlsTransportUrl(value) && new URL(value).pathname.endsWith('.m3u8');

export const cctvLiveSourceSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2_048)
      .refine(isSafeCctvHlsManifestUrl, 'CCTV HLS manifest URL must match the approved HTTPS transport boundary'),
  })
  .strict();

export type CctvLiveSource = z.infer<typeof cctvLiveSourceSchema>;

export const cctvCameraSchema = z
  .object({
    id: cctvCameraIdSchema,
    latitude: z.number().finite().min(CCTV_KOREA_BOUNDS.minimumLatitude).max(CCTV_KOREA_BOUNDS.maximumLatitude),
    longitude: z.number().finite().min(CCTV_KOREA_BOUNDS.minimumLongitude).max(CCTV_KOREA_BOUNDS.maximumLongitude),
    media: z
      .object({
        liveHls: createCctvMediaSourceSchema('live-hls'),
        stillImage: createCctvMediaSourceSchema('still-image'),
      })
      .strict(),
    name: z.string().trim().min(1).max(160),
    roadSectionId: z.string().trim().min(1).max(200).nullable(),
    roadType: cctvRoadTypeSchema,
  })
  .strict();

export type CctvRoadType = z.infer<typeof cctvRoadTypeSchema>;
export type CctvCameraId = z.infer<typeof cctvCameraIdSchema>;
export type CctvCamera = z.infer<typeof cctvCameraSchema>;

export const compareCctvCameras = (left: CctvCamera, right: CctvCamera): number => {
  if (left.roadType !== right.roadType) {
    return left.roadType === 'expressway' ? -1 : 1;
  }
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

export const cctvBoundsSchema = z
  .object({
    maximumLatitude: z.number().finite().min(CCTV_KOREA_BOUNDS.minimumLatitude).max(CCTV_KOREA_BOUNDS.maximumLatitude),
    maximumLongitude: z
      .number()
      .finite()
      .min(CCTV_KOREA_BOUNDS.minimumLongitude)
      .max(CCTV_KOREA_BOUNDS.maximumLongitude),
    minimumLatitude: z.number().finite().min(CCTV_KOREA_BOUNDS.minimumLatitude).max(CCTV_KOREA_BOUNDS.maximumLatitude),
    minimumLongitude: z
      .number()
      .finite()
      .min(CCTV_KOREA_BOUNDS.minimumLongitude)
      .max(CCTV_KOREA_BOUNDS.maximumLongitude),
  })
  .strict()
  .superRefine((bounds, context) => {
    if (bounds.minimumLatitude >= bounds.maximumLatitude) {
      context.addIssue({ code: 'custom', message: 'Latitude bounds must be ordered', path: ['minimumLatitude'] });
    }
    if (bounds.minimumLongitude >= bounds.maximumLongitude) {
      context.addIssue({ code: 'custom', message: 'Longitude bounds must be ordered', path: ['minimumLongitude'] });
    }
    if (bounds.maximumLatitude - bounds.minimumLatitude > CCTV_MAX_BBOX_SPAN_DEGREES) {
      context.addIssue({ code: 'custom', message: 'Latitude span exceeds the CCTV limit', path: ['maximumLatitude'] });
    }
    if (bounds.maximumLongitude - bounds.minimumLongitude > CCTV_MAX_BBOX_SPAN_DEGREES) {
      context.addIssue({
        code: 'custom',
        message: 'Longitude span exceeds the CCTV limit',
        path: ['maximumLongitude'],
      });
    }
  });

export const canonicalizeCctvBounds = (bounds: CctvBounds): CctvBounds => {
  const parsed = cctvBoundsSchema.parse(bounds);
  return cctvBoundsSchema.parse({
    maximumLatitude: Number(parsed.maximumLatitude.toFixed(4)),
    maximumLongitude: Number(parsed.maximumLongitude.toFixed(4)),
    minimumLatitude: Number(parsed.minimumLatitude.toFixed(4)),
    minimumLongitude: Number(parsed.minimumLongitude.toFixed(4)),
  });
};

export const cctvSnapshotSchema = z
  .object({
    bounds: cctvBoundsSchema,
    cameras: z.array(cctvCameraSchema).max(CCTV_CAMERA_LIMIT),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > CCTV_SNAPSHOT_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'CCTV snapshot exceeds the public payload budget',
        path: ['cameras'],
      });
    }

    const ids = new Set<string>();
    snapshot.cameras.forEach((camera, index) => {
      if (ids.has(camera.id)) {
        context.addIssue({ code: 'custom', message: 'CCTV IDs must be unique', path: ['cameras', index, 'id'] });
      }
      ids.add(camera.id);

      if (
        camera.latitude < snapshot.bounds.minimumLatitude ||
        camera.latitude > snapshot.bounds.maximumLatitude ||
        camera.longitude < snapshot.bounds.minimumLongitude ||
        camera.longitude > snapshot.bounds.maximumLongitude
      ) {
        context.addIssue({
          code: 'custom',
          message: 'CCTV coordinates must remain inside the requested bounds',
          path: ['cameras', index],
        });
      }

      const previous = snapshot.cameras[index - 1];
      if (previous !== undefined && compareCctvCameras(previous, camera) > 0) {
        context.addIssue({
          code: 'custom',
          message: 'CCTV cameras must use deterministic ordering',
          path: ['cameras', index],
        });
      }
    });
  });

export const cctvDataSchema = cctvSnapshotSchema;

export type CctvBounds = z.infer<typeof cctvBoundsSchema>;
export type CctvSnapshot = z.infer<typeof cctvSnapshotSchema>;
