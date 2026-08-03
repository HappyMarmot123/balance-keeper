// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  createItsContractObservation,
  createItsContractRequestUrl,
  formatItsContractObservationReport,
  hasDocumentedCoreFields,
  ITS_CONTRACT_MAX_RESPONSE_BYTES,
  ITS_OPEN_API_ORIGIN,
  ITS_SERVICE_CONTRACTS,
  ItsContractProbeError,
  isT26LiveObservationAccepted,
  probeItsServiceContract,
  readItsLiveSmokeCredential,
} from './its-nine-services-contract';

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  });

const trafficContract = ITS_SERVICE_CONTRACTS[0];
if (trafficContract === undefined) {
  throw new TypeError('The ITS traffic contract fixture is required');
}
const eventContract = ITS_SERVICE_CONTRACTS[1];
if (eventContract === undefined) {
  throw new TypeError('The ITS event contract fixture is required');
}
const detectorContract = ITS_SERVICE_CONTRACTS[3];
if (detectorContract === undefined) {
  throw new TypeError('The ITS detector contract fixture is required');
}
const dangerousCarContract = ITS_SERVICE_CONTRACTS[7];
if (dangerousCarContract === undefined) {
  throw new TypeError('The ITS dangerous-car contract fixture is required');
}
const disasterContract = ITS_SERVICE_CONTRACTS[8];
if (disasterContract === undefined) {
  throw new TypeError('The ITS disaster contract fixture is required');
}

describe('ITS nine-service contract matrix', () => {
  it('pins every approved service to its official HTTPS resource path', () => {
    expect(
      ITS_SERVICE_CONTRACTS.map(({ key, pathname, serviceId }) => ({
        key,
        pathname,
        serviceId,
      })),
    ).toEqual([
      { key: 'traffic', pathname: '/trafficInfo', serviceId: 'OPD_00000001' },
      { key: 'event', pathname: '/eventInfo', serviceId: 'OPD_00000002' },
      { key: 'forecast-traffic', pathname: '/bypassFCastInfo', serviceId: 'OPD_00000004' },
      { key: 'detector', pathname: '/vdsInfo', serviceId: 'OPD_00000005' },
      { key: 'vms', pathname: '/vmsInfo', serviceId: 'OPD_00000006' },
      { key: 'safe-driving', pathname: '/posIncidentInfo', serviceId: 'OPD_00000007' },
      { key: 'vsl', pathname: '/vslInfo', serviceId: 'OPD_00000008' },
      { key: 'dangerous-car', pathname: '/dangerousCarInfo', serviceId: 'OPD_00000017' },
      { key: 'disaster', pathname: '/disasterInfo', serviceId: 'OPD_00000020' },
    ]);
  });

  it('keeps a finite eight MiB cap for national unpaginated contract responses', () => {
    expect(ITS_CONTRACT_MAX_RESPONSE_BYTES).toBe(8 * 1024 * 1024);
  });

  it('pins non-sensitive documented core field alternatives for each service', () => {
    expect(
      Object.fromEntries(ITS_SERVICE_CONTRACTS.map((contract) => [contract.key, contract.requiredFieldGroups])),
    ).toEqual({
      'dangerous-car': [
        ['cntcManageNo', 'sntcManageNo'],
        ['acdntOccrrncDt', 'infoOccrrncDt', 'streDt'],
        ['xcrdnt'],
        ['ycrdnt'],
      ],
      detector: [['vdsId'], ['linkIds'], ['laneNo'], ['colctedDate'], ['speed'], ['volume'], ['occupancy']],
      disaster: [
        ['eventType'],
        ['startDate'],
        ['LocationInfoType', 'locationInfoType'],
        ['LocationInfo', 'locationInfo', 'locationGeometry'],
        ['message'],
      ],
      event: [['eventType'], ['startDate'], ['coordX'], ['coordY'], ['message']],
      'forecast-traffic': [['fcastDate'], ['fcastHour'], ['linkId'], ['sectionId'], ['sectionType'], ['speed']],
      'safe-driving': [
        ['message'],
        ['stepType'],
        ['outbrkType'],
        ['priority'],
        ['startStdLinkId'],
        ['startX'],
        ['startY'],
        ['occrrncId'],
      ],
      traffic: [['linkId'], ['speed'], ['travelTime'], ['createdDate']],
      vms: [['vmsId'], ['messageNo'], ['message'], ['createdDate'], ['coordX'], ['coordY']],
      vsl: [
        ['vslId'],
        ['sectionCode'],
        ['createdDate'],
        ['limitSpeed'],
        ['defLmtSpeed'],
        ['linkId'],
        ['coordX'],
        ['coordY'],
      ],
    });
  });

  it('builds one bounded JSON request per service with an exact query allowlist', () => {
    const now = Date.parse('2026-07-31T06:20:00.000Z');
    const serviceKey = 'synthetic-its-key';
    const expectedQueries = [
      {
        apiKey: serviceKey,
        drcType: 'all',
        getType: 'json',
        maxX: '127.2',
        maxY: '37.7',
        minX: '126.8',
        minY: '37.4',
        routeNo: '1',
        type: 'all',
      },
      {
        apiKey: serviceKey,
        eventType: 'all',
        getType: 'json',
        maxX: '127.2',
        maxY: '37.7',
        minX: '126.8',
        minY: '37.4',
        type: 'all',
      },
      {
        apiKey: serviceKey,
        fCastDate: '20260731',
        fCastHour: '15',
        getType: 'json',
        routeNo: '1',
        sectionId: '1',
      },
      { apiKey: serviceKey, getType: 'json' },
      { apiKey: serviceKey, getType: 'json' },
      {
        apiKey: serviceKey,
        getType: 'json',
        maxX: '127.2',
        maxY: '37.7',
        minX: '126.8',
        minY: '37.4',
      },
      { apiKey: serviceKey, getType: 'json' },
      { apiKey: serviceKey, getType: 'json' },
      {
        apiKey: serviceKey,
        category: 'D',
        endDate: '20251231',
        eventType: 'all',
        getType: 'json',
        maxX: '127.2',
        maxY: '37.7',
        minX: '126.8',
        minY: '37.4',
        startDate: '20251230',
      },
    ];

    for (const [index, contract] of ITS_SERVICE_CONTRACTS.entries()) {
      const requestUrl = createItsContractRequestUrl(contract, serviceKey, now);

      expect(requestUrl.origin).toBe(ITS_OPEN_API_ORIGIN);
      expect(requestUrl.pathname).toBe(contract.pathname);
      expect(requestUrl.username).toBe('');
      expect(requestUrl.password).toBe('');
      expect(requestUrl.hash).toBe('');
      expect(requestUrl.searchParams.getAll('apiKey')).toEqual([serviceKey]);
      expect(Object.fromEntries(requestUrl.searchParams.entries())).toEqual(expectedQueries[index]);
    }
  });

  it.each([
    '//attacker.example/collect',
    'https://attacker.example/collect',
    '/trafficInfo?redirect=https://attacker.example',
  ])('rejects a non-canonical resource path before adding the credential: %s', (pathname) => {
    const serviceKey = 'synthetic-its-key';
    let caught: unknown;

    try {
      createItsContractRequestUrl({ ...trafficContract, pathname }, serviceKey, Date.now());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ItsContractProbeError);
    expect(caught).toMatchObject({ category: 'schema', service: 'traffic' });
    expect(String(caught)).not.toContain(serviceKey);
    expect(String(caught)).not.toContain('attacker.example');
  });

  it('reduces a singleton success response to non-sensitive structural metadata', async () => {
    const serviceKey = 'synthetic-its-key';
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        response: {
          body: {
            items: {
              item: {
                coordX: '127.05',
                coordY: '37.51',
                linkId: 'sensitive-link-value',
                speed: '80',
              },
            },
            totalCount: '1',
          },
          header: { resultCode: '0', resultMsg: 'SUCCESS' },
        },
      }),
    );

    const summary = await probeItsServiceContract({
      contract: trafficContract,
      fetcher,
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey,
      signal: AbortSignal.timeout(1_000),
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [request, init] = fetcher.mock.calls[0] ?? [];
    expect(request).toBeInstanceOf(URL);
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(summary).toMatchObject({
      coordinateAxis: 'not-applicable',
      fieldKinds: {
        coordX: ['string'],
        coordY: ['string'],
        linkId: ['string'],
        speed: ['string'],
      },
      itemCount: 1,
      itemShape: 'object',
      outcome: 'success',
      service: 'traffic',
      totalCount: 1,
    });
    expect(summary.responseBytes).toBeGreaterThan(0);
    expect(JSON.stringify(summary)).not.toContain(serviceKey);
    expect(JSON.stringify(summary)).not.toContain('sensitive-link-value');
    expect(JSON.stringify(summary)).not.toContain('SUCCESS');
  });

  it('rejects an upstream response that reflects the credential before structural reporting', async () => {
    const serviceKey = 'reflectedSensitiveItsKey123';
    let caught: unknown;

    try {
      await probeItsServiceContract({
        contract: trafficContract,
        fetcher: async () =>
          jsonResponse({
            response: {
              body: {
                items: {
                  item: {
                    [serviceKey]: 'reflected-field',
                    createdDate: '20260731120000',
                    linkId: 'synthetic-link',
                    speed: '80',
                    travelTime: '120',
                  },
                },
                totalCount: 1,
              },
              header: { resultCode: 0 },
            },
          }),
        now: Date.parse('2026-07-31T06:20:00.000Z'),
        serviceKey,
        signal: AbortSignal.timeout(1_000),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ItsContractProbeError);
    expect(caught).toMatchObject({ category: 'schema', service: 'traffic' });
    expect(String(caught)).not.toContain(serviceKey);
  });

  it('accepts an omitted item collection when totalCount is zero', async () => {
    const summary = await probeItsServiceContract({
      contract: trafficContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: { totalCount: 0 },
            header: { resultCode: 0, resultMsg: 'SUCCESS' },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary).toMatchObject({
      fieldKinds: {},
      itemCount: 0,
      itemShape: 'absent',
      outcome: 'empty',
      totalCount: 0,
    });
    const observation = createItsContractObservation(trafficContract, summary);
    expect(observation.schemaStatus).toBe('unverified-empty');
    expect(isT26LiveObservationAccepted(trafficContract, observation)).toBe(false);
  });

  it.each([{ items: [] }, { items: {} }, { items: { item: [] } }])(
    'accepts documented empty collection shape $items',
    async ({ items }) => {
      const summary = await probeItsServiceContract({
        contract: trafficContract,
        fetcher: async () =>
          jsonResponse({
            response: {
              body: { items, totalCount: 0 },
              header: { resultCode: 0 },
            },
          }),
        now: Date.parse('2026-07-31T06:20:00.000Z'),
        serviceKey: 'synthetic-its-key',
        signal: AbortSignal.timeout(1_000),
      });

      expect(summary).toMatchObject({ itemCount: 0, outcome: 'empty', totalCount: 0 });
    },
  );

  it('classifies arrays without retaining any item values', async () => {
    const summary = await probeItsServiceContract({
      contract: trafficContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: [
                  { linkId: 'first-sensitive-id', speed: 40 },
                  { linkId: 'second-sensitive-id', speed: null },
                ],
              },
              totalCount: '2',
            },
            header: { resultCode: '0' },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary).toMatchObject({
      fieldKinds: { linkId: ['string'], speed: ['null', 'number'] },
      itemCount: 2,
      itemShape: 'array',
      outcome: 'success',
      totalCount: 2,
    });
    expect(JSON.stringify(summary)).not.toContain('sensitive-id');
  });

  it('rejects a mixed coordinate axis across sampled event items', async () => {
    const summary = await probeItsServiceContract({
      contract: eventContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: [
                  {
                    coordX: '127.01',
                    coordY: '37.51',
                    eventType: 'acc',
                    message: 'first event',
                    startDate: '20260731120000',
                  },
                  {
                    coordX: '37.52',
                    coordY: '127.02',
                    eventType: 'acc',
                    message: 'second event',
                    startDate: '20260731120100',
                  },
                ],
              },
              totalCount: 2,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.coordinateAxis).toBe('unknown');
    expect(hasDocumentedCoreFields(eventContract, summary)).toBe(false);
  });

  it('ignores an explicit unavailable coordinate pair while requiring one consistent observed axis', async () => {
    const summary = await probeItsServiceContract({
      contract: dangerousCarContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: [
                  {
                    acdntOccrrncDt: '20260731120000',
                    sntcManageNo: 'first-sensitive-id',
                    xcrdnt: 127.01,
                    ycrdnt: 37.51,
                  },
                  {
                    acdntOccrrncDt: '20260731120100',
                    sntcManageNo: 'second-sensitive-id',
                    xcrdnt: 0,
                    ycrdnt: 0,
                  },
                ],
              },
              totalCount: 2,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.coordinateAxis).toBe('x-longitude-y-latitude');
    expect(summary.coordinateSampleCounts).toEqual({
      invalid: 0,
      unavailable: 1,
      xLatitudeYLongitude: 0,
      xLongitudeYLatitude: 1,
    });
    expect(hasDocumentedCoreFields(dangerousCarContract, summary)).toBe(true);
  });

  it('does not treat a zero coordinate pair as unavailable outside dangerous-car', async () => {
    const summary = await probeItsServiceContract({
      contract: eventContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: [
                  {
                    coordX: '127.01',
                    coordY: '37.51',
                    eventType: 'acc',
                    message: '',
                    startDate: '20260731120000',
                  },
                  {
                    coordX: '0',
                    coordY: '0',
                    eventType: 'acc',
                    message: '',
                    startDate: '20260731120100',
                  },
                ],
              },
              totalCount: 2,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.coordinateAxis).toBe('unknown');
    expect(summary.coordinateSampleCounts).toMatchObject({ invalid: 1, unavailable: 0 });
    expect(hasDocumentedCoreFields(eventContract, summary)).toBe(false);
  });

  it('accepts blank event message text while preserving its string contract', async () => {
    const summary = await probeItsServiceContract({
      contract: eventContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: {
                  coordX: '127.01',
                  coordY: '37.51',
                  eventType: 'acc',
                  message: '',
                  startDate: '20260731120000',
                },
              },
              totalCount: 1,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.semanticValuesValid).toBe(true);
    expect(summary.semanticFailures).toEqual([]);
    expect(hasDocumentedCoreFields(eventContract, summary)).toBe(true);
  });

  it('accepts only the explicit minus-one detector sentinel below the physical range', async () => {
    const probe = async (volume: string, occupancy: string) =>
      probeItsServiceContract({
        contract: detectorContract,
        fetcher: async () =>
          jsonResponse({
            response: {
              body: {
                items: {
                  item: {
                    colctedDate: '20260731120000',
                    laneNo: '1',
                    linkIds: 'synthetic-link',
                    occupancy,
                    speed: '-1',
                    vdsId: 'synthetic-vds',
                    volume,
                  },
                },
                totalCount: 1,
              },
              header: { resultCode: 0 },
            },
          }),
        now: Date.parse('2026-07-31T06:20:00.000Z'),
        serviceKey: 'synthetic-its-key',
        signal: AbortSignal.timeout(1_000),
      });

    const unavailable = await probe('-1', '-1');
    const invalid = await probe('-2', '-2');

    expect(unavailable.semanticValuesValid).toBe(true);
    expect(unavailable.semanticFailures).toEqual([]);
    expect(hasDocumentedCoreFields(detectorContract, unavailable)).toBe(true);
    expect(invalid.semanticFailures).toEqual(['volume:number--1-1000000000', 'occupancy:number--1-100']);
    expect(hasDocumentedCoreFields(detectorContract, invalid)).toBe(false);
  });

  it('rejects malformed timestamps and numeric values without retaining them', async () => {
    const probe = async (createdDate: string, speed: string) =>
      probeItsServiceContract({
        contract: trafficContract,
        fetcher: async () =>
          jsonResponse({
            response: {
              body: {
                items: {
                  item: {
                    createdDate,
                    linkId: 'sensitive-link-id',
                    speed,
                    travelTime: '120',
                  },
                },
                totalCount: 1,
              },
              header: { resultCode: 0 },
            },
          }),
        now: Date.parse('2026-07-31T06:20:00.000Z'),
        serviceKey: 'synthetic-its-key',
        signal: AbortSignal.timeout(1_000),
      });

    const valid = await probe('20260731123000', '80');
    const invalid = await probe('not-a-timestamp', 'unknown');

    expect(valid.semanticValuesValid).toBe(true);
    expect(valid.semanticFailures).toEqual([]);
    expect(hasDocumentedCoreFields(trafficContract, valid)).toBe(true);
    expect(invalid.semanticValuesValid).toBe(false);
    expect(invalid.semanticFailures).toEqual(['createdDate:timestamp-14', 'speed:number-0-300']);
    expect(hasDocumentedCoreFields(trafficContract, invalid)).toBe(false);
    const invalidObservation = createItsContractObservation(trafficContract, invalid);
    expect(invalidObservation.schemaStatus).toBe('invalid');
    expect(isT26LiveObservationAccepted(trafficContract, invalidObservation)).toBe(false);
    expect(JSON.stringify(invalid)).not.toContain('not-a-timestamp');
    expect(JSON.stringify(invalid)).not.toContain('unknown');
    expect(JSON.stringify(invalid)).not.toContain('sensitive-link-id');
  });

  it('does not interpret optional disaster end-date and location text during the core contract probe', async () => {
    const summary = await probeItsServiceContract({
      contract: disasterContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: {
                  endDate: 'provider-specific-end-date',
                  eventType: 'disaster',
                  locationInfo: '   ',
                  locationGeometry: 'POINT (127.01 37.51)',
                  locationInfoType: 'Point',
                  message: 'sensitive-message',
                  startDate: '20260731120000',
                },
              },
              totalCount: 1,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.semanticValuesValid).toBe(true);
    expect(summary.semanticFailures).toEqual([]);
    expect(summary.geometrySampleCounts).toEqual({
      invalid: 0,
      lineString: 0,
      point: 1,
      polygon: 0,
      unavailable: 0,
    });
    expect(hasDocumentedCoreFields(disasterContract, summary)).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('sensitive');
  });

  it('rejects a disaster item when its declared geometry has no valid coordinate structure', async () => {
    const summary = await probeItsServiceContract({
      contract: disasterContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: {
                  eventType: 'disaster',
                  locationGeometry: 'garbage',
                  locationInfo: '',
                  locationInfoType: 'Point',
                  message: 'synthetic-message',
                  startDate: '20260731120000',
                },
              },
              totalCount: 1,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.semanticValuesValid).toBe(false);
    expect(summary.semanticFailures).toContain('location:valid-geometry');
    expect(summary.geometrySampleCounts.invalid).toBe(1);
    expect(hasDocumentedCoreFields(disasterContract, summary)).toBe(false);
    const observation = createItsContractObservation(disasterContract, summary);
    expect(observation.schemaStatus).toBe('deferred-geometry');
    expect(isT26LiveObservationAccepted(disasterContract, observation)).toBe(true);
    expect(isT26LiveObservationAccepted(trafficContract, observation)).toBe(false);
  });

  it('records fully blank disaster geometry as unavailable without treating it as malformed', async () => {
    const summary = await probeItsServiceContract({
      contract: disasterContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: {
                  eventType: 'disaster',
                  locationGeometry: ' ',
                  locationInfo: '',
                  locationInfoType: ' ',
                  message: 'synthetic-message',
                  startDate: '20260731120000',
                },
              },
              totalCount: 1,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.geometrySampleCounts).toEqual({
      invalid: 0,
      lineString: 0,
      point: 0,
      polygon: 0,
      unavailable: 1,
    });
    expect(summary.semanticValuesValid).toBe(false);
    expect(summary.semanticFailures).toContain('location:unavailable');
    expect(hasDocumentedCoreFields(disasterContract, summary)).toBe(false);
    const observation = createItsContractObservation(disasterContract, summary);
    expect(observation.schemaStatus).toBe('deferred-geometry');
    expect(isT26LiveObservationAccepted(disasterContract, observation)).toBe(true);
  });

  it('keeps non-geometry disaster failures outside the T26 deferred release boundary', async () => {
    const summary = await probeItsServiceContract({
      contract: disasterContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: {
                  eventType: 'disaster',
                  locationGeometry: 'garbage',
                  locationInfo: '',
                  locationInfoType: 'Point',
                  startDate: 'invalid-date',
                },
              },
              totalCount: 1,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.semanticFailures).toEqual(
      expect.arrayContaining(['startDate:timestamp-14', 'location:valid-geometry']),
    );
    expect(hasDocumentedCoreFields(disasterContract, summary)).toBe(false);
    const observation = createItsContractObservation(disasterContract, summary);
    expect(observation.schemaStatus).toBe('invalid');
    expect(isT26LiveObservationAccepted(disasterContract, observation)).toBe(false);
  });

  it.each([
    { geometry: 'LINESTRING (127.01 37.51, 127.02 37.52)', geometryType: 'LineString', valid: true },
    { geometry: 'LINESTRING (127.01 37.51)', geometryType: 'LineString', valid: false },
    {
      geometry: 'POLYGON ((127.01 37.51, 127.02 37.51, 127.02 37.52, 127.01 37.51))',
      geometryType: 'Polygon',
      valid: true,
    },
    {
      geometry: 'POLYGON ((127.01 37.51, 127.02 37.51, 127.02 37.52, 127.03 37.53))',
      geometryType: 'Polygon',
      valid: false,
    },
    { geometry: 'POLYGON ((127.01 37.51, 127.02 37.51, 127.01 37.51))', geometryType: 'Polygon', valid: false },
    { geometry: 'POINT (0x7f 0x25)', geometryType: 'Point', valid: false },
  ])('validates $geometryType WKT structure: $valid', async ({ geometry, geometryType, valid }) => {
    const summary = await probeItsServiceContract({
      contract: disasterContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: {
              items: {
                item: {
                  eventType: 'disaster',
                  locationGeometry: geometry,
                  locationInfo: '',
                  locationInfoType: geometryType,
                  message: 'synthetic-message',
                  startDate: '20260731120000',
                },
              },
              totalCount: 1,
            },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.semanticValuesValid).toBe(valid);
    expect(hasDocumentedCoreFields(disasterContract, summary)).toBe(valid);
  });

  it.each([
    {
      invalidItem: { fcastHour: '24' },
      item: {
        detourId: '1',
        fcastDate: '20260731',
        fcastHour: '15',
        length: '1000',
        linkId: '1',
        sectionId: '1',
        sectionType: 'M',
        speed: '80',
      },
      key: 'forecast-traffic',
      rule: 'fcastHour:hour-00-23',
    },
    {
      invalidItem: { createdDate: 'invalid-date' },
      item: {
        coordX: '127.01',
        coordY: '37.51',
        createdDate: '20260731120000',
        message: 'message',
        messageNo: '1',
        vmsId: '1',
      },
      key: 'vms',
      rule: 'createdDate:timestamp-14',
    },
    {
      invalidItem: { message: '' },
      item: {
        message: 'message',
        occrrncId: '1',
        outbrkType: '1',
        priority: '1',
        startStdLinkId: '1',
        startX: '127.01',
        startY: '37.51',
        stepType: '1',
      },
      key: 'safe-driving',
      rule: 'message:nonblank-string',
    },
    {
      invalidItem: { limitSpeed: '301' },
      item: {
        coordX: '37.51',
        coordY: '127.01',
        createdDate: '20260731120000',
        defLmtSpeed: '100',
        limitSpeed: '80',
        linkId: '1',
        registedDate: '20260731115900',
        sectionCode: '1',
        vslId: '1',
      },
      key: 'vsl',
      rule: 'limitSpeed:number-0-300',
    },
    {
      invalidItem: { acdntOccrrncDt: 'invalid-date' },
      item: {
        acdntOccrrncDt: '20260731120000',
        sntcManageNo: '1',
        xcrdnt: 127.01,
        ycrdnt: 37.51,
      },
      key: 'dangerous-car',
      rule: 'accidentDate:date-8-or-timestamp-14',
    },
  ])('keeps $key semantic validation deterministic offline', async ({ invalidItem, item, key, rule }) => {
    const contract = ITS_SERVICE_CONTRACTS.find((candidate) => candidate.key === key);
    if (contract === undefined) {
      throw new TypeError(`The ITS ${key} contract fixture is required`);
    }
    const probe = async (candidate: Record<string, unknown>) =>
      probeItsServiceContract({
        contract,
        fetcher: async () =>
          jsonResponse({
            response: {
              body: { items: { item: candidate }, totalCount: 1 },
              header: { resultCode: 0 },
            },
          }),
        now: Date.parse('2026-07-31T06:20:00.000Z'),
        serviceKey: 'synthetic-its-key',
        signal: AbortSignal.timeout(1_000),
      });

    const valid = await probe(item);
    const invalid = await probe({ ...item, ...invalidItem });

    expect(valid.semanticValuesValid).toBe(true);
    expect(hasDocumentedCoreFields(contract, valid)).toBe(true);
    expect(invalid.semanticFailures).toContain(rule);
    expect(hasDocumentedCoreFields(contract, invalid)).toBe(false);
  });

  it('limits field and semantic observation to the first fifty items without retaining the next value', async () => {
    const items = Array.from({ length: 51 }, (_, index) => ({
      createdDate: index === 50 ? 'unobserved-invalid-date' : '20260731120000',
      linkId: index === 50 ? 'unobserved-sensitive-link' : `synthetic-${index}`,
      speed: index === 50 ? 'unobserved-invalid-speed' : '80',
      travelTime: '120',
    }));
    const summary = await probeItsServiceContract({
      contract: trafficContract,
      fetcher: async () =>
        jsonResponse({
          response: {
            body: { items: { item: items }, totalCount: items.length },
            header: { resultCode: 0 },
          },
        }),
      now: Date.parse('2026-07-31T06:20:00.000Z'),
      serviceKey: 'synthetic-its-key',
      signal: AbortSignal.timeout(1_000),
    });

    expect(summary.itemCount).toBe(51);
    expect(summary.sampledItemCount).toBe(50);
    expect(summary.semanticValuesValid).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('unobserved');
  });

  it('distinguishes an observed documented schema from an incomplete success item', () => {
    const completeSummary = {
      coordinateAxis: 'x-longitude-y-latitude' as const,
      coordinateSampleCounts: {
        invalid: 0,
        unavailable: 0,
        xLatitudeYLongitude: 0,
        xLongitudeYLatitude: 1,
      },
      geometrySampleCounts: {
        invalid: 0,
        lineString: 0,
        point: 0,
        polygon: 0,
        unavailable: 0,
      },
      fieldCoverage: {
        createdDate: { nonNullCount: 1, presentCount: 1 },
        linkId: { nonNullCount: 1, presentCount: 1 },
        speed: { nonNullCount: 1, presentCount: 1 },
        travelTime: { nonNullCount: 1, presentCount: 1 },
      },
      fieldKinds: {
        createdDate: ['string'],
        linkId: ['string'],
        speed: ['number'],
        travelTime: ['number'],
      },
      itemCount: 1,
      itemShape: 'object' as const,
      outcome: 'success' as const,
      responseBytes: 128,
      sampledItemCount: 1,
      semanticFailures: [],
      semanticValuesValid: true,
      service: 'traffic',
      totalCount: 1,
    };

    expect(hasDocumentedCoreFields(trafficContract, completeSummary)).toBe(true);
    expect(
      hasDocumentedCoreFields(trafficContract, {
        ...completeSummary,
        fieldCoverage: {
          linkId: { nonNullCount: 1, presentCount: 1 },
          speed: { nonNullCount: 1, presentCount: 1 },
        },
        fieldKinds: { linkId: ['string'], speed: ['number'] },
      }),
    ).toBe(false);
    expect(
      hasDocumentedCoreFields(trafficContract, {
        ...completeSummary,
        fieldCoverage: {
          ...completeSummary.fieldCoverage,
          travelTime: { nonNullCount: 0, presentCount: 1 },
        },
        fieldKinds: { ...completeSummary.fieldKinds, travelTime: ['null'] },
      }),
    ).toBe(false);
    expect(
      hasDocumentedCoreFields(trafficContract, {
        ...completeSummary,
        coordinateAxis: 'unknown',
      }),
    ).toBe(true);
    expect(
      hasDocumentedCoreFields(trafficContract, {
        ...completeSummary,
        fieldCoverage: {},
        fieldKinds: {},
        itemCount: 0,
        itemShape: 'absent',
        outcome: 'empty',
        sampledItemCount: 0,
        totalCount: 0,
      }),
    ).toBe(false);
  });

  it('formats deterministic structural evidence without provider values', () => {
    const summary = {
      coordinateAxis: 'x-longitude-y-latitude' as const,
      coordinateSampleCounts: {
        invalid: 0,
        unavailable: 0,
        xLatitudeYLongitude: 0,
        xLongitudeYLatitude: 1,
      },
      geometrySampleCounts: {
        invalid: 0,
        lineString: 0,
        point: 0,
        polygon: 0,
        unavailable: 0,
      },
      fieldCoverage: {
        createdDate: { nonNullCount: 1, presentCount: 1 },
        linkId: { nonNullCount: 1, presentCount: 1 },
        speed: { nonNullCount: 1, presentCount: 1 },
        travelTime: { nonNullCount: 1, presentCount: 1 },
      },
      fieldKinds: {
        createdDate: ['string'],
        linkId: ['string'],
        speed: ['number'],
        travelTime: ['number'],
      },
      itemCount: 1,
      itemShape: 'object' as const,
      outcome: 'success' as const,
      responseBytes: 256,
      sampledItemCount: 1,
      semanticFailures: [],
      semanticValuesValid: true,
      service: 'traffic',
      totalCount: 1,
    };
    const observation = createItsContractObservation(trafficContract, summary);
    const report = formatItsContractObservationReport([observation]);

    expect(observation).toEqual({
      coordinateAxis: 'x-longitude-y-latitude',
      coordinateSampleCounts: {
        invalid: 0,
        unavailable: 0,
        xLatitudeYLongitude: 0,
        xLongitudeYLatitude: 1,
      },
      geometrySampleCounts: {
        invalid: 0,
        lineString: 0,
        point: 0,
        polygon: 0,
        unavailable: 0,
      },
      fields: {
        createdDate: { kinds: ['string'], nonNullCount: 1, presentCount: 1 },
        linkId: { kinds: ['string'], nonNullCount: 1, presentCount: 1 },
        speed: { kinds: ['number'], nonNullCount: 1, presentCount: 1 },
        travelTime: { kinds: ['number'], nonNullCount: 1, presentCount: 1 },
      },
      itemCount: 1,
      itemShape: 'object',
      responseBytes: 256,
      sampledItemCount: 1,
      schemaStatus: 'observed',
      semanticFailures: [],
      semanticValuesValid: true,
      service: 'traffic',
      totalCount: 1,
    });
    expect(report).toBe(JSON.stringify([observation]));
    expect(report).not.toContain('synthetic-its-key');
    expect(report).not.toContain('sensitive');
  });

  it.each([
    {
      category: 'transport',
      createFetcher: (serviceKey: string) => async () => {
        throw new Error(`failed request containing ${serviceKey}`);
      },
      name: 'a native transport failure',
    },
    {
      category: 'http',
      createFetcher: () => async () => jsonResponse({ error: 'raw-upstream-error' }, { status: 502 }),
      name: 'a non-success HTTP status',
    },
    {
      category: 'mime',
      createFetcher: () => async () =>
        new Response('<html>raw-upstream-error</html>', { headers: { 'content-type': 'text/html' } }),
      name: 'a non-JSON response',
    },
    {
      category: 'size',
      createFetcher: () => async () =>
        jsonResponse(
          { response: { body: { totalCount: 0 }, header: { resultCode: 0 } } },
          { headers: { 'content-length': String(ITS_CONTRACT_MAX_RESPONSE_BYTES + 1) } },
        ),
      name: 'an oversized declared body',
    },
    {
      category: 'json',
      createFetcher: () => async () =>
        new Response('{invalid-json', { headers: { 'content-type': 'application/json' } }),
      name: 'malformed JSON',
    },
    {
      category: 'provider',
      createFetcher: (serviceKey: string) => async () =>
        jsonResponse({
          response: {
            body: { totalCount: 0 },
            header: { resultCode: '1', resultMsg: `provider detail ${serviceKey}` },
          },
        }),
      name: 'a provider failure envelope',
    },
    {
      category: 'schema',
      createFetcher: () => async () =>
        jsonResponse({
          response: {
            body: { items: { item: [{ linkId: 'only-item' }] }, totalCount: 2 },
            header: { resultCode: 0 },
          },
        }),
      name: 'a count and cardinality mismatch',
    },
    {
      category: 'encoding',
      createFetcher: () => async () =>
        new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }),
      name: 'invalid UTF-8',
    },
    {
      category: 'size',
      createFetcher: () => async () =>
        new Response(`"${'x'.repeat(ITS_CONTRACT_MAX_RESPONSE_BYTES)}"`, {
          headers: { 'content-type': 'application/json' },
        }),
      name: 'an oversized streamed body',
    },
    {
      category: 'redirect',
      createFetcher: () => async () => {
        const response = jsonResponse({
          response: { body: { totalCount: 0 }, header: { resultCode: 0 } },
        });
        Object.defineProperty(response, 'url', {
          value: 'https://openapi.its.go.kr:9443/otherInfo?apiKey=redacted',
        });
        return response;
      },
      name: 'a mismatched final URL',
    },
  ])('reports $name without exposing the key or upstream body', async ({ category, createFetcher }) => {
    const serviceKey = 'synthetic-its-key';
    let caught: unknown;

    try {
      await probeItsServiceContract({
        contract: trafficContract,
        fetcher: createFetcher(serviceKey),
        now: Date.parse('2026-07-31T06:20:00.000Z'),
        serviceKey,
        signal: AbortSignal.timeout(1_000),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ItsContractProbeError);
    expect(caught).toMatchObject({ category, service: 'traffic' });
    expect(String(caught)).not.toContain(serviceKey);
    expect(String(caught)).not.toContain('raw-upstream-error');
    expect(String(caught)).not.toContain('provider detail');
  });

  it('does not read the credential while the explicit live gate is disabled', () => {
    const environment = {
      get ITS_API_KEY(): string {
        throw new Error('credential getter must stay unread');
      },
      RUN_ITS_NINE_SERVICES_LIVE_SMOKE: '0',
    };

    expect(readItsLiveSmokeCredential(environment)).toBeUndefined();
  });

  it('requires a non-blank credential when the explicit live gate is enabled', () => {
    expect(() =>
      readItsLiveSmokeCredential({
        ITS_API_KEY: '   ',
        RUN_ITS_NINE_SERVICES_LIVE_SMOKE: '1',
      }),
    ).toThrow('ITS nine-service live smoke credential is missing');
    expect(
      readItsLiveSmokeCredential({
        ITS_API_KEY: '  synthetic-its-key  ',
        RUN_ITS_NINE_SERVICES_LIVE_SMOKE: '1',
      }),
    ).toBe('synthetic-its-key');
  });
});
