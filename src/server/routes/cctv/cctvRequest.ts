import { type CctvBounds, cctvBoundsSchema } from '../../../entities/cctv/contract';
import { AppError } from '../../../shared/contracts';

const COORDINATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/u;

export const parseCctvBounds = (value: string): CctvBounds => {
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => !COORDINATE_PATTERN.test(part))) {
    throw new AppError('BAD_REQUEST');
  }
  const [minimumLongitudeText, minimumLatitudeText, maximumLongitudeText, maximumLatitudeText] = parts;
  const parsed = cctvBoundsSchema.safeParse({
    maximumLatitude: Number(maximumLatitudeText),
    maximumLongitude: Number(maximumLongitudeText),
    minimumLatitude: Number(minimumLatitudeText),
    minimumLongitude: Number(minimumLongitudeText),
  });
  if (!parsed.success) {
    throw new AppError('BAD_REQUEST');
  }
  return Object.freeze(parsed.data);
};
