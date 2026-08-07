import { type RoadTrafficCurrentBounds, roadTrafficCurrentBoundsSchema } from '../../../entities/road-traffic/contract';
import { AppError } from '../../../shared/contracts';

const COORDINATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/u;

export const parseRoadTrafficCurrentBounds = (value: string): RoadTrafficCurrentBounds => {
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => !COORDINATE_PATTERN.test(part))) {
    throw new AppError('BAD_REQUEST');
  }
  const [minimumLongitude, minimumLatitude, maximumLongitude, maximumLatitude] = parts;
  const result = roadTrafficCurrentBoundsSchema.safeParse({
    maximumLatitude: Number(maximumLatitude),
    maximumLongitude: Number(maximumLongitude),
    minimumLatitude: Number(minimumLatitude),
    minimumLongitude: Number(minimumLongitude),
  });
  if (!result.success) {
    throw new AppError('BAD_REQUEST');
  }
  return Object.freeze(result.data);
};
