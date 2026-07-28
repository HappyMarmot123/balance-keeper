import {
  type EarthquakeEvent,
  type EarthquakeSourceRef,
  earthquakeEventSchema,
  earthquakeSourceRefSchema,
  sortEarthquakeEvents,
} from '../../../entities/earthquake/contract';

const MAX_TIME_DIFFERENCE_MS = 90_000;
const MAX_DISTANCE_KM = 50;
const MAX_MAGNITUDE_DIFFERENCE = 0.7;
const EARTH_RADIUS_KM = 6_371.0088;

type SourceGroup = EarthquakeSourceRef[];

const sharesIdentity = (left: EarthquakeSourceRef, right: EarthquakeSourceRef): boolean => {
  if (left.provider !== right.provider) {
    return false;
  }
  if (left.id === right.id) {
    return true;
  }

  const aliases = new Set(left.aliases);
  return right.aliases.some((alias) => aliases.has(alias));
};

const collapseProviderRecords = (input: readonly EarthquakeSourceRef[]): EarthquakeSourceRef[] => {
  const records = input.map((record) => earthquakeSourceRefSchema.parse(record));
  const groups: SourceGroup[] = [];

  for (const record of records) {
    const matchingIndexes = groups.flatMap((group, index) =>
      group.some((candidate) => sharesIdentity(candidate, record)) ? [index] : [],
    );
    if (matchingIndexes.length === 0) {
      groups.push([record]);
      continue;
    }

    const firstIndex = matchingIndexes[0];
    if (firstIndex === undefined) {
      groups.push([record]);
      continue;
    }

    const merged = [record, ...(groups[firstIndex] ?? [])];
    for (const index of matchingIndexes.slice(1).sort((left, right) => right - left)) {
      merged.push(...(groups[index] ?? []));
      groups.splice(index, 1);
    }
    groups[firstIndex] = merged;
  }

  return groups.map((group) => {
    const latest = [...group].sort(
      (left, right) => right.updatedAt - left.updatedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )[0];
    if (latest === undefined) {
      throw new TypeError('Earthquake source group must not be empty');
    }

    return earthquakeSourceRefSchema.parse({
      ...latest,
      aliases: [...new Set(group.flatMap((record) => record.aliases))].sort(),
    });
  });
};

const degreesToRadians = (value: number): number => (value * Math.PI) / 180;

const distanceKm = (left: EarthquakeSourceRef, right: EarthquakeSourceRef): number => {
  const latitudeDelta = degreesToRadians(right.latitude - left.latitude);
  const longitudeDelta = degreesToRadians(right.longitude - left.longitude);
  const leftLatitude = degreesToRadians(left.latitude);
  const rightLatitude = degreesToRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(haversine)));
};

const isSameCrossSourceEvent = (left: EarthquakeSourceRef, right: EarthquakeSourceRef): boolean => {
  if (left.provider === right.provider || left.magnitude === null || right.magnitude === null) {
    return false;
  }

  return (
    Math.abs(left.occurredAt - right.occurredAt) <= MAX_TIME_DIFFERENCE_MS &&
    distanceKm(left, right) <= MAX_DISTANCE_KM &&
    Math.abs(left.magnitude - right.magnitude) <= MAX_MAGNITUDE_DIFFERENCE
  );
};

const createEvent = (refs: readonly EarthquakeSourceRef[]): EarthquakeEvent => {
  const sourceRefs = [...refs].sort((left, right) => {
    if (left.provider !== right.provider) {
      return left.provider === 'KMA' ? -1 : 1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const representative = sourceRefs[0];
  if (representative === undefined) {
    throw new TypeError('Earthquake event must have a representative source record');
  }

  return earthquakeEventSchema.parse({
    depthKm: representative.depthKm,
    id: `${representative.provider.toLowerCase()}:${representative.id}`,
    intensity: representative.intensity,
    latitude: representative.latitude,
    location: representative.location,
    longitude: representative.longitude,
    magnitude: representative.magnitude,
    magnitudeType: representative.magnitudeType,
    occurredAt: representative.occurredAt,
    sourceRefs,
    updatedAt: representative.updatedAt,
  });
};

export function reconcileEarthquakeRecords(
  kmaInput: readonly EarthquakeSourceRef[],
  usgsInput: readonly EarthquakeSourceRef[],
): EarthquakeEvent[] {
  const kma = collapseProviderRecords(kmaInput);
  const usgs = collapseProviderRecords(usgsInput);
  const matchedUsgs = new Set<number>();
  const events: EarthquakeEvent[] = [];

  for (const kmaRecord of kma) {
    const candidates = usgs
      .map((usgsRecord, index) => ({ distance: distanceKm(kmaRecord, usgsRecord), index, usgsRecord }))
      .filter(
        (candidate) => !matchedUsgs.has(candidate.index) && isSameCrossSourceEvent(kmaRecord, candidate.usgsRecord),
      )
      .sort(
        (left, right) =>
          Math.abs(kmaRecord.occurredAt - left.usgsRecord.occurredAt) -
            Math.abs(kmaRecord.occurredAt - right.usgsRecord.occurredAt) ||
          left.distance - right.distance ||
          (left.usgsRecord.id < right.usgsRecord.id ? -1 : left.usgsRecord.id > right.usgsRecord.id ? 1 : 0),
      );
    const match = candidates[0];

    if (match === undefined) {
      events.push(createEvent([kmaRecord]));
      continue;
    }

    matchedUsgs.add(match.index);
    events.push(createEvent([kmaRecord, match.usgsRecord]));
  }

  usgs.forEach((record, index) => {
    if (!matchedUsgs.has(index)) {
      events.push(createEvent([record]));
    }
  });

  return sortEarthquakeEvents(events);
}
