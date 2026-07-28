import { z } from 'zod';

const DAY_MS = 24 * 60 * 60_000;
const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

export const EARTHQUAKE_PUBLIC_WINDOW_MS = 7 * DAY_MS;
export const KMA_EARTHQUAKE_WINDOW_MS = 3 * DAY_MS;
export const EARTHQUAKE_EVENT_LIMIT = 500;

export const EARTHQUAKE_BOUNDS = Object.freeze({
  maximumLatitude: 45,
  maximumLongitude: 145,
  minimumLatitude: 21,
  minimumLongitude: 110,
});

export const earthquakeProviderSchema = z.enum(['KMA', 'USGS']);
export const earthquakeSourceStatusSchema = z.enum(['available', 'missing-credential', 'unavailable']);

const epochSchema = z.number().int().nonnegative().max(MAX_DATE_EPOCH_MS);
const nullableTextSchema = z.string().trim().min(1).nullable();
const nullableMagnitudeSchema = z.number().finite().min(-2).max(12).nullable();
const nullableDepthSchema = z.number().finite().min(-20).max(1_000).nullable();

export const earthquakeWindowSchema = z
  .object({
    from: epochSchema,
    to: epochSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (window.from > window.to) {
      context.addIssue({ code: 'custom', message: 'Window must not be reversed', path: ['from'] });
    }
  });

const createEarthquakeSourceWindowSchema = <StatusSchema extends z.ZodType>(statusSchema: StatusSchema) =>
  z
    .object({
      from: epochSchema,
      status: statusSchema,
      to: epochSchema,
    })
    .strict()
    .superRefine((window, context) => {
      if (window.from > window.to) {
        context.addIssue({ code: 'custom', message: 'Source window must not be reversed', path: ['from'] });
      }
    });

export const earthquakeSourceWindowSchema = createEarthquakeSourceWindowSchema(earthquakeSourceStatusSchema);
const usgsEarthquakeSourceWindowSchema = createEarthquakeSourceWindowSchema(z.enum(['available', 'unavailable']));

export const earthquakeSourceRefSchema = z
  .object({
    aliases: z.array(z.string().trim().min(1)).min(1).max(32),
    depthKm: nullableDepthSchema,
    id: z.string().trim().min(1).max(160),
    intensity: nullableTextSchema,
    latitude: z.number().finite().min(EARTHQUAKE_BOUNDS.minimumLatitude).max(EARTHQUAKE_BOUNDS.maximumLatitude),
    location: nullableTextSchema,
    longitude: z.number().finite().min(EARTHQUAKE_BOUNDS.minimumLongitude).max(EARTHQUAKE_BOUNDS.maximumLongitude),
    magnitude: nullableMagnitudeSchema,
    magnitudeType: nullableTextSchema,
    occurredAt: epochSchema,
    provider: earthquakeProviderSchema,
    updatedAt: epochSchema,
  })
  .strict()
  .superRefine((sourceRef, context) => {
    if (sourceRef.updatedAt < sourceRef.occurredAt) {
      context.addIssue({
        code: 'custom',
        message: 'Provider revision must not precede the event',
        path: ['updatedAt'],
      });
    }

    const canonicalAliases = [...new Set(sourceRef.aliases)].sort();
    if (
      canonicalAliases.length !== sourceRef.aliases.length ||
      canonicalAliases.some((alias, index) => alias !== sourceRef.aliases[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Provider aliases must be unique and deterministically sorted',
        path: ['aliases'],
      });
    }
  });

export type EarthquakeProvider = z.infer<typeof earthquakeProviderSchema>;
export type EarthquakeSourceStatus = z.infer<typeof earthquakeSourceStatusSchema>;
export type EarthquakeWindow = z.infer<typeof earthquakeWindowSchema>;
export type EarthquakeSourceWindow = z.infer<typeof earthquakeSourceWindowSchema>;
export type EarthquakeSourceRef = z.infer<typeof earthquakeSourceRefSchema>;

const providerOrder: Readonly<Record<EarthquakeProvider, number>> = Object.freeze({
  KMA: 0,
  USGS: 1,
});

const representativeFields = [
  'depthKm',
  'intensity',
  'latitude',
  'location',
  'longitude',
  'magnitude',
  'magnitudeType',
  'occurredAt',
  'updatedAt',
] as const;

export const earthquakeEventSchema = z
  .object({
    depthKm: nullableDepthSchema,
    id: z.string().trim().min(1).max(200),
    intensity: nullableTextSchema,
    latitude: z.number().finite().min(EARTHQUAKE_BOUNDS.minimumLatitude).max(EARTHQUAKE_BOUNDS.maximumLatitude),
    location: nullableTextSchema,
    longitude: z.number().finite().min(EARTHQUAKE_BOUNDS.minimumLongitude).max(EARTHQUAKE_BOUNDS.maximumLongitude),
    magnitude: nullableMagnitudeSchema,
    magnitudeType: nullableTextSchema,
    occurredAt: epochSchema,
    sourceRefs: z.array(earthquakeSourceRefSchema).min(1).max(2),
    updatedAt: epochSchema,
  })
  .strict()
  .superRefine((event, context) => {
    const providers = event.sourceRefs.map((sourceRef) => sourceRef.provider);
    if (new Set(providers).size !== providers.length) {
      context.addIssue({
        code: 'custom',
        message: 'An event may contain only one record per provider',
        path: ['sourceRefs'],
      });
    }

    const canonicalProviders = [...providers].sort((left, right) => providerOrder[left] - providerOrder[right]);
    if (canonicalProviders.some((provider, index) => provider !== providers[index])) {
      context.addIssue({
        code: 'custom',
        message: 'Provider records must have deterministic ordering',
        path: ['sourceRefs'],
      });
    }

    const representative = event.sourceRefs[0];
    if (representative === undefined) {
      return;
    }

    const expectedId = `${representative.provider.toLowerCase()}:${representative.id}`;
    if (event.id !== expectedId) {
      context.addIssue({ code: 'custom', message: 'Event ID must identify its representative record', path: ['id'] });
    }

    for (const field of representativeFields) {
      if (!Object.is(event[field], representative[field])) {
        context.addIssue({
          code: 'custom',
          message: 'Event fields must match its representative record',
          path: [field],
        });
      }
    }
  });

export type EarthquakeEvent = z.infer<typeof earthquakeEventSchema>;

export const compareEarthquakeEvents = (left: EarthquakeEvent, right: EarthquakeEvent): number => {
  const timeOrder = right.occurredAt - left.occurredAt;
  if (timeOrder !== 0) {
    return timeOrder;
  }

  const leftMagnitude = left.magnitude ?? Number.NEGATIVE_INFINITY;
  const rightMagnitude = right.magnitude ?? Number.NEGATIVE_INFINITY;
  const magnitudeOrder = rightMagnitude - leftMagnitude;
  if (magnitudeOrder !== 0) {
    return magnitudeOrder;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

export const sortEarthquakeEvents = (events: readonly EarthquakeEvent[]): EarthquakeEvent[] =>
  [...events].sort(compareEarthquakeEvents);

const coverageSchema = z
  .object({
    maximumLatitude: z.literal(EARTHQUAKE_BOUNDS.maximumLatitude),
    maximumLongitude: z.literal(EARTHQUAKE_BOUNDS.maximumLongitude),
    minimumLatitude: z.literal(EARTHQUAKE_BOUNDS.minimumLatitude),
    minimumLongitude: z.literal(EARTHQUAKE_BOUNDS.minimumLongitude),
  })
  .strict();

const publicWindowSchema = z
  .object({
    from: epochSchema,
    to: epochSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (window.to - window.from !== EARTHQUAKE_PUBLIC_WINDOW_MS) {
      context.addIssue({ code: 'custom', message: 'Earthquake snapshot must cover seven days', path: ['from'] });
    }
  });

export const earthquakeSnapshotSchema = z
  .object({
    coverage: coverageSchema,
    events: z.array(earthquakeEventSchema).max(EARTHQUAKE_EVENT_LIMIT),
    sources: z
      .object({
        kma: earthquakeSourceWindowSchema,
        usgs: usgsEarthquakeSourceWindowSchema,
      })
      .strict(),
    window: publicWindowSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const expectedKmaFrom = snapshot.window.to - KMA_EARTHQUAKE_WINDOW_MS;
    if (snapshot.sources.kma.from !== expectedKmaFrom || snapshot.sources.kma.to !== snapshot.window.to) {
      context.addIssue({
        code: 'custom',
        message: 'KMA source window must cover the provider-supported three days',
        path: ['sources', 'kma'],
      });
    }
    if (snapshot.sources.usgs.from !== snapshot.window.from || snapshot.sources.usgs.to !== snapshot.window.to) {
      context.addIssue({
        code: 'custom',
        message: 'USGS source window must match the public seven-day window',
        path: ['sources', 'usgs'],
      });
    }

    if (snapshot.sources.kma.status !== 'available' && snapshot.sources.usgs.status !== 'available') {
      context.addIssue({
        code: 'custom',
        message: 'At least one earthquake source must be available',
        path: ['sources'],
      });
    }

    const sorted = sortEarthquakeEvents(snapshot.events);
    snapshot.events.forEach((event, index) => {
      if (event.id !== sorted[index]?.id) {
        context.addIssue({
          code: 'custom',
          message: 'Earthquake events must be deterministically sorted',
          path: ['events', index],
        });
      }

      if (event.occurredAt < snapshot.window.from || event.occurredAt > snapshot.window.to) {
        context.addIssue({
          code: 'custom',
          message: 'Earthquake event falls outside the public window',
          path: ['events', index, 'occurredAt'],
        });
      }

      event.sourceRefs.forEach((sourceRef, sourceIndex) => {
        const source = sourceRef.provider === 'KMA' ? snapshot.sources.kma : snapshot.sources.usgs;
        if (source.status !== 'available') {
          context.addIssue({
            code: 'custom',
            message: 'An unavailable provider cannot contribute event records',
            path: ['events', index, 'sourceRefs', sourceIndex, 'provider'],
          });
        }
        if (sourceRef.occurredAt < source.from || sourceRef.occurredAt > source.to) {
          context.addIssue({
            code: 'custom',
            message: 'Provider record falls outside its declared source window',
            path: ['events', index, 'sourceRefs', sourceIndex, 'occurredAt'],
          });
        }
      });
    });
  });

export const earthquakeDataSchema = earthquakeSnapshotSchema;

export type EarthquakeSnapshot = z.infer<typeof earthquakeSnapshotSchema>;
