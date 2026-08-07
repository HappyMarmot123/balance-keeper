export type {
  RoadTrafficCurrentBounds,
  RoadTrafficCurrentSegment,
  RoadTrafficCurrentSnapshot,
} from './model/roadTrafficCurrent';
export {
  canonicalizeRoadTrafficCurrentBounds,
  compareRoadTrafficCurrentSegments,
  ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS,
  ROAD_TRAFFIC_CURRENT_MAX_BBOX_SPAN_DEGREES,
  ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH,
  ROAD_TRAFFIC_CURRENT_MAX_SEGMENTS,
  ROAD_TRAFFIC_CURRENT_MAX_SERIALIZED_BYTES,
  ROAD_TRAFFIC_CURRENT_SPEED_UNIT,
  roadTrafficCurrentBoundsSchema,
  roadTrafficCurrentDataSchema,
  roadTrafficCurrentSnapshotSchema,
} from './model/roadTrafficCurrent';
export type { RoadTrafficForecastSegment, RoadTrafficForecastSnapshot } from './model/roadTrafficForecast';
export {
  compareRoadTrafficForecastSegments,
  ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH,
  ROAD_TRAFFIC_FORECAST_MAX_SEGMENTS,
  ROAD_TRAFFIC_FORECAST_MAX_SERIALIZED_BYTES,
  ROAD_TRAFFIC_FORECAST_SPEED_UNIT,
  roadTrafficForecastDataSchema,
  roadTrafficForecastSnapshotSchema,
} from './model/roadTrafficForecast';
