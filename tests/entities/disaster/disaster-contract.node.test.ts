// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as disasterModule from '../../../src/entities/disaster';

const disaster = disasterModule as Record<string, unknown>;

const snapshot = {
  alerts: [
    {
      disasterType: '호우',
      emergencyStep: '긴급재난',
      id: '9002',
      issuedAt: Date.parse('2026-07-29T07:30:00.000Z'),
      message: '[행정안전부]  원문을 그대로 표시합니다.',
      regionText: '서울특별시 전체, 경기도 일부',
    },
    {
      disasterType: '폭염',
      emergencyStep: '안전안내',
      id: '9001',
      issuedAt: Date.parse('2026-07-29T07:00:00.000Z'),
      message: '야외 활동 시 충분한 물을 준비하십시오.',
      regionText: '전국',
    },
  ],
} as const;

describe('disaster alert entity contract', () => {
  it('exports the strict original-message snapshot and provisional source attribution', () => {
    expect(disaster.DISASTER_SOURCE).toEqual({
      label: '행정안전부 긴급재난문자',
      license: '공공누리 제4유형 기준 적용',
    });
    expect(disaster.disasterDataSchema).toBeTypeOf('object');

    const schema = disaster.disasterDataSchema as
      | { parse(input: unknown): { alerts: readonly { message: string; regionText: string }[] } }
      | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    const parsed = schema.parse(snapshot);
    expect(parsed).toEqual(snapshot);
    expect(parsed.alerts[0]?.message).toBe(snapshot.alerts[0].message);
    expect(parsed.alerts[0]?.regionText).toBe(snapshot.alerts[0].regionText);
    expect(() => schema.parse({ ...snapshot, summary: '추가 가공문' })).toThrow();
    expect(() =>
      schema.parse({
        alerts: [{ ...snapshot.alerts[0], translatedMessage: 'Derived text is forbidden' }],
      }),
    ).toThrow();
  });

  it('requires a unique, bounded and deterministic newest-first alert list', () => {
    const schema = disaster.disasterDataSchema as { parse(input: unknown): unknown } | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() =>
      schema.parse({
        alerts: [snapshot.alerts[0], snapshot.alerts[0]],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        alerts: [...snapshot.alerts].reverse(),
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        alerts: Array.from({ length: 51 }, (_, index) => ({
          ...snapshot.alerts[0],
          id: String(10_000 - index),
          issuedAt: snapshot.alerts[0].issuedAt - index,
        })),
      }),
    ).toThrow();
  });

  it('rejects timestamps outside the JavaScript Date rendering range', () => {
    const schema = disaster.disasterDataSchema as { parse(input: unknown): unknown } | undefined;
    expect(schema).toBeDefined();
    if (schema === undefined) {
      return;
    }

    expect(() =>
      schema.parse({
        alerts: [
          {
            ...snapshot.alerts[0],
            issuedAt: 8_640_000_000_000_001,
          },
        ],
      }),
    ).toThrow();
  });
});
