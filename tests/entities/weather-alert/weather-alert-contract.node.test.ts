// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as weatherAlertModule from '../../../src/entities/weather-alert';

const weatherAlert = weatherAlertModule as Record<string, unknown>;

const snapshot = {
  alerts: [
    {
      areaCode: 'L1010100',
      areaName: '서울특별시',
      command: 'issue',
      commandCode: 1,
      effectiveAt: Date.parse('2026-07-31T10:00:00+09:00'),
      endsAt: Date.parse('2026-07-31T18:00:00+09:00'),
      id: '202607310900-31-L1010100-12',
      issuedAt: Date.parse('2026-07-31T09:00:00+09:00'),
      kind: 'heat-wave',
      kindCode: 12,
      level: 'warning',
      levelCode: 1,
    },
    {
      areaCode: 'L1020000',
      areaName: '경기도 일부',
      command: 'extend',
      commandCode: 3,
      effectiveAt: Date.parse('2026-07-31T11:00:00+09:00'),
      endsAt: null,
      id: '202607311000-32-L1020000-12',
      issuedAt: Date.parse('2026-07-31T10:00:00+09:00'),
      kind: 'heat-wave',
      kindCode: 12,
      level: 'advisory',
      levelCode: 0,
    },
  ],
  bulletin: {
    availability: 'available',
    details: '야외 활동과 온열질환에 유의하십시오.',
    issuedAt: Date.parse('2026-07-31T09:00:00+09:00'),
    title: '폭염경보·폭염주의보 발표',
  },
  statusEffectiveAt: Date.parse('2026-07-31T10:00:00+09:00'),
  statusIssuedAt: Date.parse('2026-07-31T09:00:00+09:00'),
} as const;

describe('weather alert entity contract', () => {
  it('exports strict source attribution and a nullable active snapshot', () => {
    expect(weatherAlert.WEATHER_ALERT_SOURCE).toEqual({
      label: '기상청 기상특보',
      license: '공공누리 제1유형',
    });
    expect(weatherAlert.weatherAlertDataSchema).toBeTypeOf('object');

    const schema = weatherAlert.weatherAlertDataSchema as
      | { parse(input: unknown): unknown; safeParse(input: unknown): { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(schema.parse(snapshot)).toEqual(snapshot);
    expect(schema.parse(null)).toBeNull();
    expect(schema.safeParse({ ...snapshot, rawStatus: 'provider text must not escape' }).success).toBe(false);
  });

  it('requires unique active area-kind pairs in deterministic severity order', () => {
    const schema = weatherAlert.weatherAlertDataSchema as { parse(input: unknown): unknown } | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() => schema.parse({ ...snapshot, alerts: [...snapshot.alerts].reverse() })).toThrow();
    expect(() => schema.parse({ ...snapshot, alerts: [snapshot.alerts[0], snapshot.alerts[0]] })).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        alerts: [
          snapshot.alerts[0],
          {
            ...snapshot.alerts[0],
            id: '202607311100-33-L1010100-12',
          },
        ],
      }),
    ).toThrow();
  });

  it('preserves documented code mappings and allows unknown codes only as unknown', () => {
    const schema = weatherAlert.weatherAlertDataSchema as { parse(input: unknown): unknown } | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() =>
      schema.parse({
        ...snapshot,
        alerts: [{ ...snapshot.alerts[0], kind: 'unknown' }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        alerts: [{ ...snapshot.alerts[0], level: 'unknown' }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        alerts: [{ ...snapshot.alerts[0], command: 'correction' }],
      }),
    ).toThrow();

    expect(
      schema.parse({
        ...snapshot,
        alerts: [
          {
            ...snapshot.alerts[0],
            id: '202607311200-34-L1030000-99',
            areaCode: 'L1030000',
            areaName: '확인되지 않은 구역',
            command: 'correction',
            commandCode: 6,
            kind: 'unknown',
            kindCode: 99,
            level: 'unknown',
            levelCode: 9,
          },
        ],
      }),
    ).toBeDefined();
  });

  it('rejects invalid chronology, blank provider text and unsupported bulletin shapes', () => {
    const schema = weatherAlert.weatherAlertDataSchema as { parse(input: unknown): unknown } | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() =>
      schema.parse({
        ...snapshot,
        alerts: [{ ...snapshot.alerts[0], effectiveAt: snapshot.alerts[0].issuedAt - 1 }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        alerts: [{ ...snapshot.alerts[0], endsAt: snapshot.alerts[0].effectiveAt - 1 }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        alerts: [{ ...snapshot.alerts[0], areaName: '   ' }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...snapshot,
        bulletin: { availability: 'unavailable', title: 'invented fallback' },
      }),
    ).toThrow();
  });
});
