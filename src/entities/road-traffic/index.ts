export type { RoadTrafficCurrentQueryDependencies } from './api/roadTrafficCurrentQuery';
export {
  createRoadTrafficCurrentPath,
  ROAD_TRAFFIC_CURRENT_QUERY_PROFILE,
  roadTrafficCurrentQueryOptions,
} from './api/roadTrafficCurrentQuery';
export type { RoadTrafficDetectorQueryDependencies } from './api/roadTrafficDetectorsQuery';
export {
  ROAD_TRAFFIC_DETECTOR_QUERY_PROFILE,
  roadTrafficDetectorQueryOptions,
} from './api/roadTrafficDetectorsQuery';
export type { RoadTrafficForecastQueryDependencies } from './api/roadTrafficForecastQuery';
export {
  ROAD_TRAFFIC_FORECAST_QUERY_PROFILE,
  roadTrafficForecastQueryOptions,
} from './api/roadTrafficForecastQuery';
export type {
  RoadTrafficCurrentBounds,
  RoadTrafficCurrentSegment,
  RoadTrafficCurrentSnapshot,
  RoadTrafficDetector,
  RoadTrafficDetectorObservation,
  RoadTrafficDetectorSnapshot,
  RoadTrafficForecastSegment,
  RoadTrafficForecastSnapshot,
} from './contract';
export {
  canonicalizeRoadTrafficCurrentBounds,
  compareRoadTrafficCurrentSegments,
  compareRoadTrafficDetectorObservations,
  compareRoadTrafficDetectors,
  compareRoadTrafficForecastSegments,
  ROAD_TRAFFIC_CURRENT_KOREA_BOUNDS,
  ROAD_TRAFFIC_CURRENT_MAX_BBOX_SPAN_DEGREES,
  ROAD_TRAFFIC_CURRENT_MAX_ID_LENGTH,
  ROAD_TRAFFIC_CURRENT_MAX_SEGMENTS,
  ROAD_TRAFFIC_CURRENT_MAX_SERIALIZED_BYTES,
  ROAD_TRAFFIC_CURRENT_SPEED_UNIT,
  ROAD_TRAFFIC_DETECTOR_MAX_ID_LENGTH,
  ROAD_TRAFFIC_DETECTOR_MAX_LINKS,
  ROAD_TRAFFIC_DETECTOR_MAX_OBSERVATIONS,
  ROAD_TRAFFIC_DETECTOR_MAX_SERIALIZED_BYTES,
  ROAD_TRAFFIC_DETECTOR_METRIC_UNIT,
  ROAD_TRAFFIC_DETECTOR_SOURCE_TIME_BASIS,
  ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH,
  ROAD_TRAFFIC_FORECAST_MAX_SEGMENTS,
  ROAD_TRAFFIC_FORECAST_MAX_SERIALIZED_BYTES,
  ROAD_TRAFFIC_FORECAST_SPEED_UNIT,
  roadTrafficCurrentBoundsSchema,
  roadTrafficCurrentDataSchema,
  roadTrafficCurrentSnapshotSchema,
  roadTrafficDetectorDataSchema,
  roadTrafficDetectorSnapshotSchema,
  roadTrafficForecastDataSchema,
  roadTrafficForecastSnapshotSchema,
} from './contract';
