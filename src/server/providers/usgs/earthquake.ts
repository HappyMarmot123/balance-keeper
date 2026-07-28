import { z } from 'zod';

import {
  EARTHQUAKE_BOUNDS,
  type EarthquakeSourceRef,
  earthquakeSourceRefSchema,
  earthquakeWindowSchema,
} from '../../../entities/earthquake/contract';

const USGS_WEEKLY_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';

const geometrySchema = z
  .object({
    coordinates: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    type: z.literal('Point'),
  })
  .strict();

const propertiesSchema = z
  .object({
    ids: z.string(),
    mag: z.number().finite().nullable(),
    magType: z.string().trim().min(1).nullable(),
    place: z.string().trim().min(1).nullable(),
    time: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    type: z.string().min(1),
    updated: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .passthrough();

const featureSchema = z
  .object({
    geometry: geometrySchema,
    id: z.string().trim().min(1).max(160),
    properties: propertiesSchema,
    type: z.literal('Feature'),
  })
  .strict();

const feedSchema = z
  .object({
    bbox: z.array(z.number().finite()).length(6).optional(),
    features: z.array(featureSchema).max(20_000),
    metadata: z
      .object({
        api: z.string().min(1),
        count: z.number().int().nonnegative().max(20_000),
        generated: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        status: z.number().int(),
        title: z.string().min(1),
        url: z.string().url(),
      })
      .strict(),
    type: z.literal('FeatureCollection'),
  })
  .strict();

export type UsgsEarthquakeWindow = Readonly<{ from: number; to: number }>;

export type FetchUsgsEarthquakeRecordsOptions = Readonly<{
  fetcher: typeof fetch;
  signal: AbortSignal;
  window: UsgsEarthquakeWindow;
}>;

class UsgsEarthquakeProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'UsgsEarthquakeProviderError';
  }
}

const parseAliases = (input: string, preferredId: string): string[] => {
  const declared = input
    .split(',')
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0);
  if (new Set(declared).size !== declared.length) {
    throw new UsgsEarthquakeProviderError('USGS earthquake aliases contain duplicates');
  }
  return [...new Set([...declared, preferredId])].sort();
};

const assertGlobalCoordinate = (value: number, axis: 'latitude' | 'longitude'): void => {
  const [minimum, maximum] = axis === 'latitude' ? [-90, 90] : [-180, 180];
  if (value < minimum || value > maximum) {
    throw new UsgsEarthquakeProviderError(`USGS earthquake ${axis} is invalid`);
  }
};

const isInApprovedBounds = (latitude: number, longitude: number): boolean =>
  latitude >= EARTHQUAKE_BOUNDS.minimumLatitude &&
  latitude <= EARTHQUAKE_BOUNDS.maximumLatitude &&
  longitude >= EARTHQUAKE_BOUNDS.minimumLongitude &&
  longitude <= EARTHQUAKE_BOUNDS.maximumLongitude;

export function normalizeUsgsEarthquakeFeed(input: unknown, windowInput: UsgsEarthquakeWindow) {
  let window: UsgsEarthquakeWindow;
  try {
    window = earthquakeWindowSchema.parse(windowInput);
  } catch (error) {
    throw new UsgsEarthquakeProviderError('USGS earthquake source window is invalid', error);
  }

  let feed: z.infer<typeof feedSchema>;
  try {
    feed = feedSchema.parse(input);
  } catch (error) {
    throw new UsgsEarthquakeProviderError('USGS earthquake feed is invalid', error);
  }

  if (feed.metadata.status !== 200) {
    throw new UsgsEarthquakeProviderError('USGS earthquake feed returned a non-success status');
  }
  if (feed.metadata.count !== feed.features.length) {
    throw new UsgsEarthquakeProviderError('USGS earthquake feature count is inconsistent');
  }

  const records: EarthquakeSourceRef[] = [];
  for (const feature of feed.features) {
    const [longitude, latitude, depthKm] = feature.geometry.coordinates;
    assertGlobalCoordinate(latitude, 'latitude');
    assertGlobalCoordinate(longitude, 'longitude');

    if (
      feature.properties.type !== 'earthquake' ||
      feature.properties.time < window.from ||
      feature.properties.time > window.to ||
      !isInApprovedBounds(latitude, longitude)
    ) {
      continue;
    }

    try {
      records.push(
        earthquakeSourceRefSchema.parse({
          aliases: parseAliases(feature.properties.ids, feature.id),
          depthKm,
          id: feature.id,
          intensity: null,
          latitude,
          location: feature.properties.place,
          longitude,
          magnitude: feature.properties.mag,
          magnitudeType: feature.properties.magType,
          occurredAt: feature.properties.time,
          provider: 'USGS',
          updatedAt: feature.properties.updated,
        }),
      );
    } catch (error) {
      if (error instanceof UsgsEarthquakeProviderError) {
        throw error;
      }
      throw new UsgsEarthquakeProviderError('Normalized USGS earthquake record is invalid', error);
    }
  }

  return records.sort(
    (left, right) => right.occurredAt - left.occurredAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

const throwAbortReason = (signal: AbortSignal): never => {
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

export async function fetchUsgsEarthquakeRecords(
  options: FetchUsgsEarthquakeRecordsOptions,
): Promise<EarthquakeSourceRef[]> {
  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }

  let response: Response;
  try {
    response = await options.fetcher(USGS_WEEKLY_FEED, {
      headers: { Accept: 'application/geo+json, application/json' },
      method: 'GET',
      redirect: 'error',
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new UsgsEarthquakeProviderError('USGS earthquake request failed', error);
  }

  if (options.signal.aborted) {
    throwAbortReason(options.signal);
  }
  if (!response.ok) {
    throw new UsgsEarthquakeProviderError('USGS earthquake request returned a non-success status');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (options.signal.aborted) {
      throwAbortReason(options.signal);
    }
    throw new UsgsEarthquakeProviderError('USGS earthquake response was not valid JSON', error);
  }

  return normalizeUsgsEarthquakeFeed(payload, options.window);
}
