import {
  CCTV_KOREA_BOUNDS,
  CCTV_MAX_BBOX_SPAN_DEGREES,
  type CctvBounds,
  canonicalizeCctvBounds,
} from '../../../entities/cctv';
import type { KoreaMapViewport } from '../../../entities/map';

export function resolveCctvBounds(viewport: KoreaMapViewport): CctvBounds | undefined {
  const queryable =
    viewport.minimumLatitude >= CCTV_KOREA_BOUNDS.minimumLatitude &&
    viewport.maximumLatitude <= CCTV_KOREA_BOUNDS.maximumLatitude &&
    viewport.minimumLongitude >= CCTV_KOREA_BOUNDS.minimumLongitude &&
    viewport.maximumLongitude <= CCTV_KOREA_BOUNDS.maximumLongitude &&
    viewport.maximumLatitude - viewport.minimumLatitude <= CCTV_MAX_BBOX_SPAN_DEGREES &&
    viewport.maximumLongitude - viewport.minimumLongitude <= CCTV_MAX_BBOX_SPAN_DEGREES;
  if (!queryable) {
    return undefined;
  }

  try {
    return canonicalizeCctvBounds({
      maximumLatitude: viewport.maximumLatitude,
      maximumLongitude: viewport.maximumLongitude,
      minimumLatitude: viewport.minimumLatitude,
      minimumLongitude: viewport.minimumLongitude,
    });
  } catch {
    return undefined;
  }
}
