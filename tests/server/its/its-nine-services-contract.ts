export type ItsServiceContract = Readonly<{
  key: string;
  pathname: string;
  requiredFieldGroups: readonly (readonly string[])[];
  serviceId: string;
}>;

export type ItsContractProbeErrorCategory =
  | 'encoding'
  | 'http'
  | 'json'
  | 'mime'
  | 'provider'
  | 'redirect'
  | 'schema'
  | 'size'
  | 'transport';

export type ItsContractProbeSummary = Readonly<{
  coordinateAxis: 'not-applicable' | 'unknown' | 'x-latitude-y-longitude' | 'x-longitude-y-latitude';
  coordinateSampleCounts: Readonly<{
    invalid: number;
    unavailable: number;
    xLatitudeYLongitude: number;
    xLongitudeYLatitude: number;
  }>;
  geometrySampleCounts: Readonly<{
    invalid: number;
    lineString: number;
    point: number;
    polygon: number;
    unavailable: number;
  }>;
  fieldCoverage: Readonly<
    Record<
      string,
      Readonly<{
        nonNullCount: number;
        presentCount: number;
      }>
    >
  >;
  fieldKinds: Readonly<Record<string, readonly string[]>>;
  itemCount: number;
  itemShape: 'absent' | 'array' | 'object';
  outcome: 'empty' | 'success';
  responseBytes: number;
  sampledItemCount: number;
  semanticFailures: readonly string[];
  semanticValuesValid: boolean;
  service: string;
  totalCount: number;
}>;

export type ProbeItsServiceContractOptions = Readonly<{
  contract: ItsServiceContract;
  fetcher: typeof fetch;
  now: number;
  serviceKey: string;
  signal: AbortSignal;
}>;

export type ItsLiveSmokeEnvironment = Readonly<{
  ITS_API_KEY?: string;
  RUN_ITS_NINE_SERVICES_LIVE_SMOKE?: string;
}>;

export type ItsContractObservation = Readonly<{
  coordinateAxis: ItsContractProbeSummary['coordinateAxis'];
  coordinateSampleCounts: ItsContractProbeSummary['coordinateSampleCounts'];
  fields: Readonly<
    Record<
      string,
      Readonly<{
        kinds: readonly string[];
        nonNullCount: number;
        presentCount: number;
      }>
    >
  >;
  geometrySampleCounts: ItsContractProbeSummary['geometrySampleCounts'];
  itemCount: number;
  itemShape: ItsContractProbeSummary['itemShape'];
  responseBytes: number;
  sampledItemCount: number;
  schemaStatus: 'deferred-geometry' | 'invalid' | 'observed' | 'unverified-empty';
  semanticFailures: readonly string[];
  semanticValuesValid: boolean;
  service: string;
  totalCount: number;
}>;

export class ItsContractProbeError extends Error {
  readonly category: ItsContractProbeErrorCategory;
  readonly service: string;

  constructor(service: string, category: ItsContractProbeErrorCategory) {
    super(`${service}:${category}`);
    this.name = 'ItsContractProbeError';
    this.category = category;
    this.service = service;
  }
}

export const ITS_OPEN_API_ORIGIN = 'https://openapi.its.go.kr:9443';
export const ITS_CONTRACT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const ITS_SERVICE_CONTRACTS: readonly ItsServiceContract[] = [
  {
    key: 'traffic',
    pathname: '/trafficInfo',
    requiredFieldGroups: [['linkId'], ['speed'], ['travelTime'], ['createdDate']],
    serviceId: 'OPD_00000001',
  },
  {
    key: 'event',
    pathname: '/eventInfo',
    requiredFieldGroups: [['eventType'], ['startDate'], ['coordX'], ['coordY'], ['message']],
    serviceId: 'OPD_00000002',
  },
  {
    key: 'forecast-traffic',
    pathname: '/bypassFCastInfo',
    requiredFieldGroups: [['fcastDate'], ['fcastHour'], ['linkId'], ['sectionId'], ['sectionType'], ['speed']],
    serviceId: 'OPD_00000004',
  },
  {
    key: 'detector',
    pathname: '/vdsInfo',
    requiredFieldGroups: [['vdsId'], ['linkIds'], ['laneNo'], ['colctedDate'], ['speed'], ['volume'], ['occupancy']],
    serviceId: 'OPD_00000005',
  },
  {
    key: 'vms',
    pathname: '/vmsInfo',
    requiredFieldGroups: [['vmsId'], ['messageNo'], ['message'], ['createdDate'], ['coordX'], ['coordY']],
    serviceId: 'OPD_00000006',
  },
  {
    key: 'safe-driving',
    pathname: '/posIncidentInfo',
    requiredFieldGroups: [
      ['message'],
      ['stepType'],
      ['outbrkType'],
      ['priority'],
      ['startStdLinkId'],
      ['startX'],
      ['startY'],
      ['occrrncId'],
    ],
    serviceId: 'OPD_00000007',
  },
  {
    key: 'vsl',
    pathname: '/vslInfo',
    requiredFieldGroups: [
      ['vslId'],
      ['sectionCode'],
      ['createdDate'],
      ['limitSpeed'],
      ['defLmtSpeed'],
      ['linkId'],
      ['coordX'],
      ['coordY'],
    ],
    serviceId: 'OPD_00000008',
  },
  {
    key: 'dangerous-car',
    pathname: '/dangerousCarInfo',
    requiredFieldGroups: [
      ['cntcManageNo', 'sntcManageNo'],
      ['acdntOccrrncDt', 'infoOccrrncDt', 'streDt'],
      ['xcrdnt'],
      ['ycrdnt'],
    ],
    serviceId: 'OPD_00000017',
  },
  {
    key: 'disaster',
    pathname: '/disasterInfo',
    requiredFieldGroups: [
      ['eventType'],
      ['startDate'],
      ['LocationInfoType', 'locationInfoType'],
      ['LocationInfo', 'locationInfo'],
      ['message'],
    ],
    serviceId: 'OPD_00000020',
  },
];

export const readItsLiveSmokeCredential = (environment: ItsLiveSmokeEnvironment): string | undefined => {
  if (environment.RUN_ITS_NINE_SERVICES_LIVE_SMOKE !== '1') {
    return undefined;
  }
  const credential = environment.ITS_API_KEY?.trim();
  if (credential === undefined || credential.length === 0) {
    throw new Error('ITS nine-service live smoke credential is missing');
  }
  return credential;
};

const hasDocumentedFieldShape = (contract: ItsServiceContract, summary: ItsContractProbeSummary): boolean =>
  summary.outcome === 'success' &&
  summary.sampledItemCount > 0 &&
  contract.requiredFieldGroups.every((alternatives) =>
    alternatives.some((field) => {
      const coverage = summary.fieldCoverage[field];
      const kinds = summary.fieldKinds[field];
      return (
        coverage !== undefined &&
        kinds !== undefined &&
        coverage.presentCount === summary.sampledItemCount &&
        coverage.nonNullCount > 0 &&
        kinds.every((kind) => kind === 'null' || kind === 'number' || kind === 'string')
      );
    }),
  );

const hasRequiredCoordinateAxis = (contract: ItsServiceContract, summary: ItsContractProbeSummary): boolean =>
  !['dangerous-car', 'event', 'safe-driving', 'vms', 'vsl'].includes(contract.key) ||
  summary.coordinateAxis === 'x-latitude-y-longitude' ||
  summary.coordinateAxis === 'x-longitude-y-latitude';

export const hasDocumentedCoreFields = (contract: ItsServiceContract, summary: ItsContractProbeSummary): boolean =>
  hasDocumentedFieldShape(contract, summary) &&
  summary.semanticValuesValid &&
  hasRequiredCoordinateAxis(contract, summary);

const DEFERRED_DISASTER_GEOMETRY_FAILURES = new Set(['location:unavailable', 'location:valid-geometry']);

const hasOnlyDeferredDisasterGeometryFailures = (
  contract: ItsServiceContract,
  summary: ItsContractProbeSummary,
): boolean =>
  contract.key === 'disaster' &&
  hasDocumentedFieldShape(contract, summary) &&
  !summary.semanticValuesValid &&
  summary.semanticFailures.length > 0 &&
  summary.semanticFailures.every((failure) => DEFERRED_DISASTER_GEOMETRY_FAILURES.has(failure)) &&
  summary.geometrySampleCounts.invalid + summary.geometrySampleCounts.unavailable > 0;

export const createItsContractObservation = (
  contract: ItsServiceContract,
  summary: ItsContractProbeSummary,
): ItsContractObservation => {
  const fields = Object.fromEntries(
    Object.keys(summary.fieldKinds)
      .sort()
      .map((field) => {
        const coverage = summary.fieldCoverage[field];
        const kinds = summary.fieldKinds[field];
        if (coverage === undefined || kinds === undefined) {
          throw new ItsContractProbeError(contract.key, 'schema');
        }
        return [field, { kinds, ...coverage }];
      }),
  );
  return {
    coordinateAxis: summary.coordinateAxis,
    coordinateSampleCounts: summary.coordinateSampleCounts,
    fields,
    geometrySampleCounts: summary.geometrySampleCounts,
    itemCount: summary.itemCount,
    itemShape: summary.itemShape,
    responseBytes: summary.responseBytes,
    sampledItemCount: summary.sampledItemCount,
    schemaStatus:
      summary.outcome === 'empty'
        ? 'unverified-empty'
        : hasDocumentedCoreFields(contract, summary)
          ? 'observed'
          : hasOnlyDeferredDisasterGeometryFailures(contract, summary)
            ? 'deferred-geometry'
            : 'invalid',
    semanticFailures: summary.semanticFailures,
    semanticValuesValid: summary.semanticValuesValid,
    service: contract.key,
    totalCount: summary.totalCount,
  };
};

export const isT26LiveObservationAccepted = (
  contract: ItsServiceContract,
  observation: ItsContractObservation,
): boolean => {
  if (observation.service !== contract.key) {
    return false;
  }
  if (observation.schemaStatus === 'observed') {
    return observation.semanticValuesValid;
  }
  return (
    contract.key === 'disaster' &&
    observation.schemaStatus === 'deferred-geometry' &&
    !observation.semanticValuesValid &&
    observation.semanticFailures.length > 0 &&
    observation.semanticFailures.every((failure) => DEFERRED_DISASTER_GEOMETRY_FAILURES.has(failure)) &&
    observation.geometrySampleCounts.invalid + observation.geometrySampleCounts.unavailable > 0
  );
};

export const formatItsContractObservationReport = (observations: readonly ItsContractObservation[]): string =>
  JSON.stringify(observations);

const appendSeoulBounds = (searchParams: URLSearchParams): void => {
  searchParams.set('minX', '126.8');
  searchParams.set('maxX', '127.2');
  searchParams.set('minY', '37.4');
  searchParams.set('maxY', '37.7');
};

const getKstRequestSlot = (now: number): Readonly<{ date: string; hour: string }> => {
  const kst = new Date(now + 9 * 60 * 60_000);
  const year = String(kst.getUTCFullYear()).padStart(4, '0');
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const hour = String(kst.getUTCHours()).padStart(2, '0');
  return { date: `${year}${month}${day}`, hour };
};

export const createItsContractRequestUrl = (contract: ItsServiceContract, serviceKey: string, now: number): URL => {
  const approvedContract = ITS_SERVICE_CONTRACTS.find(({ key }) => key === contract.key);
  if (
    approvedContract === undefined ||
    contract.pathname !== approvedContract.pathname ||
    contract.serviceId !== approvedContract.serviceId
  ) {
    const safeService = approvedContract?.key ?? 'unknown';
    throw new ItsContractProbeError(safeService, 'schema');
  }
  const url = new URL(contract.pathname, ITS_OPEN_API_ORIGIN);
  if (
    url.origin !== ITS_OPEN_API_ORIGIN ||
    url.pathname !== approvedContract.pathname ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new ItsContractProbeError(approvedContract.key, 'schema');
  }
  url.searchParams.set('apiKey', serviceKey);

  switch (contract.key) {
    case 'traffic':
      url.searchParams.set('type', 'all');
      url.searchParams.set('routeNo', '1');
      url.searchParams.set('drcType', 'all');
      appendSeoulBounds(url.searchParams);
      break;
    case 'event':
      url.searchParams.set('type', 'all');
      url.searchParams.set('eventType', 'all');
      appendSeoulBounds(url.searchParams);
      break;
    case 'forecast-traffic': {
      const slot = getKstRequestSlot(now);
      url.searchParams.set('sectionId', '1');
      url.searchParams.set('routeNo', '1');
      url.searchParams.set('fCastDate', slot.date);
      url.searchParams.set('fCastHour', slot.hour);
      break;
    }
    case 'safe-driving':
      appendSeoulBounds(url.searchParams);
      break;
    case 'disaster':
      url.searchParams.set('category', 'D');
      url.searchParams.set('eventType', 'all');
      url.searchParams.set('startDate', '20251230');
      url.searchParams.set('endDate', '20251231');
      appendSeoulBounds(url.searchParams);
      break;
  }

  url.searchParams.set('getType', 'json');
  return url;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getNestedValue = (value: unknown, path: readonly string[]): unknown => {
  let current = value;
  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
};

const getFirstNestedValue = (value: unknown, paths: readonly (readonly string[])[]): unknown => {
  for (const path of paths) {
    const candidate = getNestedValue(value, path);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
};

const throwProbeError = (contract: ItsServiceContract, category: ItsContractProbeErrorCategory): never => {
  throw new ItsContractProbeError(contract.key, category);
};

const readBoundedResponse = async (response: Response, contract: ItsServiceContract): Promise<Uint8Array> => {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > ITS_CONTRACT_MAX_RESPONSE_BYTES)
  ) {
    return throwProbeError(contract, 'size');
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      received += chunk.value.byteLength;
      if (received > ITS_CONTRACT_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return throwProbeError(contract, 'size');
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof ItsContractProbeError) {
      throw error;
    }
    return throwProbeError(contract, 'transport');
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const parseCount = (value: unknown, contract: ItsServiceContract): number => {
  const count =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/u.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    return throwProbeError(contract, 'schema');
  }
  return count;
};

const getFieldKind = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
};

const summarizeFields = (
  items: readonly Record<string, unknown>[],
  contract: ItsServiceContract,
): Readonly<{
  fieldCoverage: ItsContractProbeSummary['fieldCoverage'];
  fieldKinds: ItsContractProbeSummary['fieldKinds'];
  sampledItemCount: number;
}> => {
  const sampledItems = items.slice(0, 50);
  const observations = new Map<
    string,
    {
      kinds: Set<string>;
      nonNullCount: number;
      presentCount: number;
    }
  >();
  for (const item of sampledItems) {
    for (const [field, value] of Object.entries(item)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field) || (!observations.has(field) && observations.size >= 64)) {
        return throwProbeError(contract, 'schema');
      }
      const observation = observations.get(field) ?? {
        kinds: new Set<string>(),
        nonNullCount: 0,
        presentCount: 0,
      };
      observation.kinds.add(getFieldKind(value));
      observation.presentCount += 1;
      if (value !== null) {
        observation.nonNullCount += 1;
      }
      observations.set(field, observation);
    }
  }
  const sortedObservations = [...observations.entries()].sort(([left], [right]) => left.localeCompare(right));
  return {
    fieldCoverage: Object.fromEntries(
      sortedObservations.map(([field, { nonNullCount, presentCount }]) => [field, { nonNullCount, presentCount }]),
    ),
    fieldKinds: Object.fromEntries(sortedObservations.map(([field, { kinds }]) => [field, [...kinds].sort()])),
    sampledItemCount: sampledItems.length,
  };
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
};

const coordinateFieldsByService: Readonly<Record<string, readonly [string, string]>> = {
  'dangerous-car': ['xcrdnt', 'ycrdnt'],
  event: ['coordX', 'coordY'],
  'safe-driving': ['startX', 'startY'],
  vms: ['coordX', 'coordY'],
  vsl: ['coordX', 'coordY'],
};

const classifyCoordinateSamples = (
  items: readonly Record<string, unknown>[],
  contract: ItsServiceContract,
): Readonly<{
  coordinateAxis: ItsContractProbeSummary['coordinateAxis'];
  coordinateSampleCounts: ItsContractProbeSummary['coordinateSampleCounts'];
}> => {
  const fields = coordinateFieldsByService[contract.key];
  const coordinateSampleCounts = {
    invalid: 0,
    unavailable: 0,
    xLatitudeYLongitude: 0,
    xLongitudeYLatitude: 0,
  };
  if (fields === undefined) {
    return { coordinateAxis: 'not-applicable', coordinateSampleCounts };
  }
  for (const item of items.slice(0, 50)) {
    const x = toFiniteNumber(item[fields[0]]);
    const y = toFiniteNumber(item[fields[1]]);
    if (x === undefined || y === undefined) {
      coordinateSampleCounts.invalid += 1;
      continue;
    }
    if (contract.key === 'dangerous-car' && x === 0 && y === 0) {
      coordinateSampleCounts.unavailable += 1;
      continue;
    }
    if (x >= 124 && x <= 132 && y >= 32 && y <= 40) {
      coordinateSampleCounts.xLongitudeYLatitude += 1;
    } else if (x >= 32 && x <= 40 && y >= 124 && y <= 132) {
      coordinateSampleCounts.xLatitudeYLongitude += 1;
    } else {
      coordinateSampleCounts.invalid += 1;
    }
  }
  const coordinateAxis =
    coordinateSampleCounts.invalid === 0 &&
    coordinateSampleCounts.xLongitudeYLatitude > 0 &&
    coordinateSampleCounts.xLatitudeYLongitude === 0
      ? 'x-longitude-y-latitude'
      : coordinateSampleCounts.invalid === 0 &&
          coordinateSampleCounts.xLatitudeYLongitude > 0 &&
          coordinateSampleCounts.xLongitudeYLatitude === 0
        ? 'x-latitude-y-longitude'
        : 'unknown';
  return { coordinateAxis, coordinateSampleCounts };
};

const getAlternativeValue = (item: Record<string, unknown>, fields: readonly string[]): unknown => {
  for (const field of fields) {
    if (Object.hasOwn(item, field)) {
      return item[field];
    }
  }
  return undefined;
};

const everySampledValue = (
  items: readonly Record<string, unknown>[],
  fields: readonly string[],
  predicate: (value: unknown) => boolean,
): boolean =>
  items.slice(0, 50).every((item) => {
    const value = getAlternativeValue(item, fields);
    return value !== undefined && predicate(value);
  });

const isNonBlankString = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
const isString = (value: unknown): boolean => typeof value === 'string';
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;

const parseCoordinatePair = (value: string): readonly [number, number] | undefined => {
  const parts = value.trim().split(/\s+/u);
  if (parts.length !== 2 || !parts.every((part) => DECIMAL_NUMBER.test(part))) {
    return undefined;
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  return Number.isFinite(x) && Number.isFinite(y) && x >= 124 && x <= 132 && y >= 32 && y <= 40 ? [x, y] : undefined;
};

const parseCoordinateSequence = (
  value: string,
  minimumPairs: number,
): readonly (readonly [number, number])[] | undefined => {
  const pairs = value.split(',').map(parseCoordinatePair);
  return pairs.length >= minimumPairs && pairs.every((pair) => pair !== undefined)
    ? (pairs as readonly (readonly [number, number])[])
    : undefined;
};

const countDistinctCoordinatePairs = (pairs: readonly (readonly [number, number])[]): number =>
  new Set(pairs.map(([longitude, latitude]) => `${longitude}\u0000${latitude}`)).size;

const isValidDisasterGeometry = (value: unknown, geometryType: string): boolean => {
  if (typeof value !== 'string') {
    return false;
  }
  if (geometryType === '1') {
    return parseCoordinatePair(value) !== undefined;
  }
  if (geometryType === '2') {
    const pairs = parseCoordinateSequence(value, 2);
    return pairs !== undefined && countDistinctCoordinatePairs(pairs) >= 2;
  }
  if (geometryType === '3') {
    const pairs = parseCoordinateSequence(value, 3);
    return pairs !== undefined && countDistinctCoordinatePairs(pairs) >= 3;
  }
  return false;
};

const getConsistentAlternativeValue = (
  item: Record<string, unknown>,
  fields: readonly string[],
  normalize: (value: unknown) => string | undefined,
): Readonly<{ conflict: boolean; value: unknown }> => {
  const values = fields.filter((field) => Object.hasOwn(item, field)).map((field) => item[field]);
  if (values.length === 0) {
    return { conflict: false, value: undefined };
  }
  const normalized = values.map(normalize);
  const first = normalized[0];
  return {
    conflict: first === undefined || normalized.some((value) => value === undefined || value !== first),
    value: values[0],
  };
};

const classifyDisasterGeometry = (
  items: readonly Record<string, unknown>[],
  contract: ItsServiceContract,
): ItsContractProbeSummary['geometrySampleCounts'] => {
  const geometrySampleCounts = {
    invalid: 0,
    lineString: 0,
    point: 0,
    polygon: 0,
    unavailable: 0,
  };
  if (contract.key !== 'disaster') {
    return geometrySampleCounts;
  }

  for (const item of items.slice(0, 50)) {
    const typeResult = getConsistentAlternativeValue(item, ['LocationInfoType', 'locationInfoType'], (value) =>
      typeof value === 'string' || typeof value === 'number' ? String(value).trim() : undefined,
    );
    const locationResult = getConsistentAlternativeValue(item, ['LocationInfo', 'locationInfo'], (value) =>
      typeof value === 'string' ? value.trim() : undefined,
    );
    const typeValue = typeResult.value;
    const locationValue = locationResult.value;
    if (
      typeResult.conflict ||
      locationResult.conflict ||
      (typeof typeValue !== 'string' && typeof typeValue !== 'number') ||
      typeof locationValue !== 'string'
    ) {
      geometrySampleCounts.invalid += 1;
      continue;
    }
    const geometryType = String(typeValue).trim();
    const hasLocation = isNonBlankString(locationValue);
    if (geometryType === '' && !hasLocation) {
      geometrySampleCounts.unavailable += 1;
    } else {
      const validGeometry = isValidDisasterGeometry(locationValue, geometryType);
      if (!validGeometry) {
        geometrySampleCounts.invalid += 1;
      } else if (geometryType === '1') {
        geometrySampleCounts.point += 1;
      } else if (geometryType === '2') {
        geometrySampleCounts.lineString += 1;
      } else if (geometryType === '3') {
        geometrySampleCounts.polygon += 1;
      } else {
        geometrySampleCounts.invalid += 1;
      }
    }
  }
  return geometrySampleCounts;
};

const isTimestamp =
  (digits: 8 | 14) =>
  (value: unknown): boolean =>
    typeof value === 'string' && new RegExp(`^\\d{${digits}}$`, 'u').test(value);

const isHour = (value: unknown): boolean => typeof value === 'string' && /^(?:[01]\d|2[0-3])$/u.test(value);

const isNumericBetween =
  (minimum: number, maximum: number) =>
  (value: unknown): boolean => {
    const number = toFiniteNumber(value);
    return number !== undefined && number >= minimum && number <= maximum;
  };

const validateSemanticValues = (
  items: readonly Record<string, unknown>[],
  contract: ItsServiceContract,
  geometrySampleCounts: ItsContractProbeSummary['geometrySampleCounts'],
): Readonly<{ semanticFailures: readonly string[]; semanticValuesValid: boolean }> => {
  if (items.length === 0) {
    return { semanticFailures: ['items:non-empty'], semanticValuesValid: false };
  }
  const semanticFailures: string[] = [];
  const check = (rule: string, fields: readonly string[], predicate: (value: unknown) => boolean): void => {
    if (!everySampledValue(items, fields, predicate)) {
      semanticFailures.push(rule);
    }
  };
  switch (contract.key) {
    case 'traffic':
      check('createdDate:timestamp-14', ['createdDate'], isTimestamp(14));
      check('speed:number-0-300', ['speed'], isNumericBetween(0, 300));
      check('travelTime:number-0-86400', ['travelTime'], isNumericBetween(0, 86_400));
      break;
    case 'event':
      check('startDate:timestamp-14', ['startDate'], isTimestamp(14));
      check('eventType:nonblank-string', ['eventType'], isNonBlankString);
      check('message:string', ['message'], isString);
      break;
    case 'forecast-traffic':
      check('fcastDate:date-8', ['fcastDate'], isTimestamp(8));
      check('fcastHour:hour-00-23', ['fcastHour'], isHour);
      check('speed:number-0-300', ['speed'], isNumericBetween(0, 300));
      check('length:number-0-10000000', ['length'], isNumericBetween(0, 10_000_000));
      break;
    case 'detector':
      check('colctedDate:timestamp-14', ['colctedDate'], isTimestamp(14));
      check('speed:number--1-300', ['speed'], isNumericBetween(-1, 300));
      check('volume:number--1-1000000000', ['volume'], isNumericBetween(-1, 1_000_000_000));
      check('occupancy:number--1-100', ['occupancy'], isNumericBetween(-1, 100));
      break;
    case 'vms':
      check('createdDate:timestamp-14', ['createdDate'], isTimestamp(14));
      check('message:nonblank-string', ['message'], isNonBlankString);
      break;
    case 'safe-driving':
      check('message:nonblank-string', ['message'], isNonBlankString);
      break;
    case 'vsl':
      check('createdDate:timestamp-14', ['createdDate'], isTimestamp(14));
      check('registedDate:timestamp-14', ['registedDate'], isTimestamp(14));
      check('limitSpeed:number-0-300', ['limitSpeed'], isNumericBetween(0, 300));
      check('defLmtSpeed:number-0-300', ['defLmtSpeed'], isNumericBetween(0, 300));
      break;
    case 'dangerous-car':
      check(
        'accidentDate:date-8-or-timestamp-14',
        ['acdntOccrrncDt', 'infoOccrrncDt', 'streDt'],
        (value) => typeof value === 'string' && /^(?:\d{8}|\d{14})$/u.test(value),
      );
      break;
    case 'disaster':
      check('startDate:timestamp-14', ['startDate'], isTimestamp(14));
      check('eventType:nonblank-string', ['eventType'], isNonBlankString);
      check('message:nonblank-string', ['message'], isNonBlankString);
      if (geometrySampleCounts.invalid > 0) {
        semanticFailures.push('location:valid-geometry');
      }
      if (geometrySampleCounts.unavailable > 0) {
        semanticFailures.push('location:unavailable');
      }
      break;
    default:
      return { semanticFailures: ['service:unsupported'], semanticValuesValid: false };
  }

  return { semanticFailures, semanticValuesValid: semanticFailures.length === 0 };
};

export const probeItsServiceContract = async ({
  contract,
  fetcher,
  now,
  serviceKey,
  signal,
}: ProbeItsServiceContractOptions): Promise<ItsContractProbeSummary> => ({
  ...(await (async (): Promise<Omit<ItsContractProbeSummary, 'service'>> => {
    if (serviceKey.trim() === '') {
      return throwProbeError(contract, 'schema');
    }
    const requestUrl = createItsContractRequestUrl(contract, serviceKey, now);
    let response: Response;
    try {
      response = await fetcher(requestUrl, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { accept: 'application/json' },
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal,
      });
    } catch {
      return throwProbeError(contract, 'transport');
    }

    if (response.redirected) {
      return throwProbeError(contract, 'redirect');
    }
    if (response.url !== '') {
      try {
        const finalUrl = new URL(response.url);
        if (finalUrl.href !== requestUrl.href) {
          return throwProbeError(contract, 'redirect');
        }
      } catch {
        return throwProbeError(contract, 'redirect');
      }
    }
    if (response.status !== 200) {
      return throwProbeError(contract, 'http');
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/u.test(contentType)) {
      return throwProbeError(contract, 'mime');
    }

    const bytes = await readBoundedResponse(response, contract);
    let bodyText: string;
    try {
      bodyText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return throwProbeError(contract, 'encoding');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return throwProbeError(contract, 'json');
    }
    if (!isRecord(payload)) {
      return throwProbeError(contract, 'schema');
    }

    const resultCode = getFirstNestedValue(payload, [
      ['response', 'header', 'resultCode'],
      ['header', 'resultCode'],
      ['resultCode'],
    ]);
    if (resultCode !== 0 && resultCode !== '0') {
      return throwProbeError(contract, resultCode === undefined ? 'schema' : 'provider');
    }
    if (bodyText.includes(serviceKey)) {
      return throwProbeError(contract, 'schema');
    }

    const rawTotalCount = getFirstNestedValue(payload, [
      ['response', 'body', 'totalCount'],
      ['body', 'totalCount'],
      ['totalCount'],
    ]);
    const totalCount = parseCount(rawTotalCount, contract);
    const rawItems = getFirstNestedValue(payload, [
      ['response', 'body', 'items', 'item'],
      ['response', 'body', 'items'],
      ['response', 'body', 'data'],
      ['body', 'items', 'item'],
      ['body', 'items'],
      ['body', 'data'],
      ['response', 'data'],
      ['data'],
    ]);

    let itemShape: ItsContractProbeSummary['itemShape'];
    let items: readonly Record<string, unknown>[];
    if (rawItems === undefined || rawItems === null) {
      itemShape = 'absent';
      items = [];
    } else if (Array.isArray(rawItems)) {
      if (!rawItems.every(isRecord)) {
        return throwProbeError(contract, 'schema');
      }
      itemShape = 'array';
      items = rawItems;
    } else if (isRecord(rawItems) && Object.keys(rawItems).length === 0 && totalCount === 0) {
      itemShape = 'absent';
      items = [];
    } else if (isRecord(rawItems)) {
      itemShape = 'object';
      items = [rawItems];
    } else {
      return throwProbeError(contract, 'schema');
    }

    if (items.length !== totalCount) {
      return throwProbeError(contract, 'schema');
    }

    const coordinateSummary = classifyCoordinateSamples(items, contract);
    const fieldSummary = summarizeFields(items, contract);
    const geometrySampleCounts = classifyDisasterGeometry(items, contract);
    const semanticSummary = validateSemanticValues(items, contract, geometrySampleCounts);
    return {
      ...coordinateSummary,
      ...fieldSummary,
      geometrySampleCounts,
      itemCount: items.length,
      itemShape,
      outcome: totalCount === 0 ? 'empty' : 'success',
      responseBytes: bytes.byteLength,
      ...semanticSummary,
      totalCount,
    };
  })()),
  service: contract.key,
});
