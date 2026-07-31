import { fetchJson, type JsonFetcher } from '../../../shared/api';
import {
  type CctvBounds,
  type CctvCameraId,
  type CctvLiveSource,
  canonicalizeCctvBounds,
  cctvCameraIdSchema,
  cctvLiveSourceSchema,
} from '../model/cctv';

export type CctvLiveStreamReference = Readonly<{
  bounds: CctvBounds;
  cameraId: CctvCameraId;
}>;

export type FetchCctvLiveSourceOptions = Readonly<{
  fetcher?: JsonFetcher;
  signal?: AbortSignal;
}>;

const formatCoordinate = (value: number): string => String(Number(value.toFixed(4)));

export function createCctvLiveStreamPath(reference: CctvLiveStreamReference): `/api/cctv/stream?${string}` {
  const cameraId = cctvCameraIdSchema.parse(reference.cameraId);
  const bounds = canonicalizeCctvBounds(reference.bounds);
  const bbox = [bounds.minimumLongitude, bounds.minimumLatitude, bounds.maximumLongitude, bounds.maximumLatitude]
    .map(formatCoordinate)
    .join(',');
  return `/api/cctv/stream?cameraId=${encodeURIComponent(cameraId)}&bbox=${bbox}`;
}

export async function fetchCctvLiveSource(
  reference: CctvLiveStreamReference,
  options: FetchCctvLiveSourceOptions = {},
): Promise<CctvLiveSource> {
  const envelope = await fetchJson(createCctvLiveStreamPath(reference), cctvLiveSourceSchema, options);
  return envelope.data;
}
