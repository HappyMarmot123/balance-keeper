export type { RoadTrafficForecastQueryDependencies } from './api/roadTrafficForecastQuery';
export {
  ROAD_TRAFFIC_FORECAST_QUERY_PROFILE,
  roadTrafficForecastQueryOptions,
} from './api/roadTrafficForecastQuery';
export type { RoadTrafficForecastSegment, RoadTrafficForecastSnapshot } from './contract';
export {
  compareRoadTrafficForecastSegments,
  ROAD_TRAFFIC_FORECAST_MAX_ID_LENGTH,
  ROAD_TRAFFIC_FORECAST_MAX_SEGMENTS,
  ROAD_TRAFFIC_FORECAST_MAX_SERIALIZED_BYTES,
  ROAD_TRAFFIC_FORECAST_SPEED_UNIT,
  roadTrafficForecastDataSchema,
  roadTrafficForecastSnapshotSchema,
} from './contract';
