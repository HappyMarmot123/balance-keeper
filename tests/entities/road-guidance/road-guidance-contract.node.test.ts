// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

type ParseResult = Readonly<{ success: boolean }>;
type ParseableSchema = Readonly<{
  safeParse(input: unknown): ParseResult;
}>;

const contractModulePath = '../../../src/entities/road-guidance/contract.ts';
let contract: Readonly<Record<string, unknown>> = {};

beforeAll(async () => {
  if (existsSync(resolve(process.cwd(), 'src/entities/road-guidance/contract.ts'))) {
    contract = (await import(/* @vite-ignore */ contractModulePath)) as Readonly<Record<string, unknown>>;
  }
});

const schema = (name: string): ParseableSchema | undefined => contract[name] as ParseableSchema | undefined;

const timestamp = '20260803120000';
const timeBasis = 'provider-local-unspecified';
const vmsId = (suffix: string) => `its-road-guidance:vms:${suffix.padStart(32, '0')}`;
const safetyId = (suffix: string) => `its-road-guidance:safety-notice:${suffix.padStart(32, '0')}`;
const speedLimitId = (suffix: string) => `its-road-guidance:vsl:${suffix.padStart(32, '0')}`;

const vmsItem = (id = vmsId('1')) => ({
  id,
  pages: [
    { lines: ['첫 번째 안내', '두 번째 안내'], order: 1 },
    { lines: [], order: 2 },
  ],
  position: [127.01, 37.51],
  sourceTimestamp: timestamp,
  timeBasis,
});

const safetyItem = (id = safetyId('1')) => ({
  id,
  message: '전방 주의운전 구간',
  position: [127.02, 37.52],
  providerPriorityCode: 3,
  providerStepCode: 5,
  providerType: '12',
});

const speedLimitItem = (id = speedLimitId('1')) => ({
  defaultLimitSpeed: 80,
  id,
  limitSpeed: 100,
  linkId: null,
  position: [127.03, 37.53],
  restrictionState: 'provider-unspecified',
  roadClass: 'national-road',
  roadNumber: '1',
  sourceCreatedTimestamp: '20260803120100',
  sourceRegisteredTimestamp: '20260803115900',
  speedUnit: 'provider-unspecified',
  timeBasis,
});

const snapshot = (channel: string, items: readonly unknown[]) => ({
  channel,
  generatedAt: Date.parse('2026-08-03T12:05:00+09:00'),
  items,
});

describe('road guidance public contract', () => {
  it('exports three separate strict snapshot schemas and bounded constants', () => {
    expect(schema('vmsGuidanceSnapshotSchema')).toBeDefined();
    expect(schema('safetyNoticeSnapshotSchema')).toBeDefined();
    expect(schema('variableSpeedLimitSnapshotSchema')).toBeDefined();
    expect(contract.ROAD_GUIDANCE_MAX_SERIALIZED_BYTES).toBe(2 * 1024 * 1024);
    expect(contract.VMS_GUIDANCE_MAX_ITEMS).toBe(2_500);
    expect(contract.SAFETY_NOTICE_MAX_ITEMS).toBe(2_500);
    expect(contract.VARIABLE_SPEED_LIMIT_MAX_ITEMS).toBe(5_000);
  });

  it('keeps the server-safe contract free of browser query exports', () => {
    expect(contract.vmsGuidanceQueryOptions).toBeUndefined();
    expect(contract.safetyNoticeQueryOptions).toBeUndefined();
    expect(contract.variableSpeedLimitQueryOptions).toBeUndefined();
  });

  it('accepts channel-specific VMS pages including an explicitly empty page', () => {
    const target = schema('vmsGuidanceSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    expect(target.safeParse(snapshot('vms', [vmsItem()])).success).toBe(true);
  });

  it.each([
    [[{ lines: ['안내'], order: 2 }], 'sequence does not start at one'],
    [
      [
        { lines: ['안내'], order: 1 },
        { lines: ['안내'], order: 3 },
      ],
      'sequence is not contiguous',
    ],
    [
      [
        { lines: ['안내'], order: 1 },
        { lines: ['다른 안내'], order: 1 },
      ],
      'sequence is duplicated',
    ],
    [[{ lines: [' 안내'], order: 1 }], 'line is not canonical'],
    [[{ lines: ['안내|문구'], order: 1 }], 'line still contains the provider delimiter'],
    [[{ lines: ['<script>안내</script>'], order: 1 }], 'line contains markup delimiters'],
    [[{ lines: ['안내\u0000문구'], order: 1 }], 'line contains a control character'],
  ])('rejects a VMS page when $1', (pages) => {
    const target = schema('vmsGuidanceSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    expect(target.safeParse(snapshot('vms', [{ ...vmsItem(), pages }])).success).toBe(false);
  });

  it('rejects more than sixteen VMS pages or eight lines per page', () => {
    const target = schema('vmsGuidanceSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    const pages = Array.from({ length: 17 }, (_, index) => ({ lines: [], order: index + 1 }));
    const lines = Array.from({ length: 9 }, (_, index) => `안내 ${index + 1}`);
    expect(target.safeParse(snapshot('vms', [{ ...vmsItem(), pages }])).success).toBe(false);
    expect(target.safeParse(snapshot('vms', [{ ...vmsItem(), pages: [{ lines, order: 1 }] }])).success).toBe(false);
  });

  it('requires canonical hashed IDs, Korea positions and valid source-local timestamps', () => {
    const target = schema('vmsGuidanceSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    expect(target.safeParse(snapshot('vms', [{ ...vmsItem(), id: 'raw-vms-id' }])).success).toBe(false);
    expect(target.safeParse(snapshot('vms', [{ ...vmsItem(), position: [37.51, 127.01] }])).success).toBe(false);
    expect(target.safeParse(snapshot('vms', [{ ...vmsItem(), sourceTimestamp: '20260230120000' }])).success).toBe(
      false,
    );
    expect(target.safeParse(snapshot('vms', [{ ...vmsItem(), timeBasis: 'Asia/Seoul' }])).success).toBe(false);
  });

  it('accepts safety notices with numeric canonical provider codes only', () => {
    const target = schema('safetyNoticeSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    expect(target.safeParse(snapshot('safety-notices', [safetyItem()])).success).toBe(true);
    expect(
      target.safeParse(
        snapshot('safety-notices', [{ ...safetyItem(), providerPriorityCode: '3', providerStepCode: '5' }]),
      ).success,
    ).toBe(false);
    expect(target.safeParse(snapshot('safety-notices', [{ ...safetyItem(), providerStepCode: -1 }])).success).toBe(
      false,
    );
  });

  it('does not permit timestamps, lifecycle or severity on a safety notice', () => {
    const target = schema('safetyNoticeSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    for (const extra of [{ sourceTimestamp: timestamp }, { lifecycle: 'active' }, { severity: 'high' }]) {
      expect(target.safeParse(snapshot('safety-notices', [{ ...safetyItem(), ...extra }])).success).toBe(false);
    }
  });

  it('requires a canonical plain safety message and provider type', () => {
    const target = schema('safetyNoticeSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    expect(target.safeParse(snapshot('safety-notices', [{ ...safetyItem(), message: ' 주의' }])).success).toBe(false);
    expect(target.safeParse(snapshot('safety-notices', [{ ...safetyItem(), message: '주의\u202e' }])).success).toBe(
      false,
    );
    expect(target.safeParse(snapshot('safety-notices', [{ ...safetyItem(), providerType: '' }])).success).toBe(false);
  });

  it('accepts VSL values without inferring state from speed or timestamp order', () => {
    const target = schema('variableSpeedLimitSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    expect(target.safeParse(snapshot('variable-speed-limits', [speedLimitItem()])).success).toBe(true);
    expect(
      target.safeParse(
        snapshot('variable-speed-limits', [
          {
            ...speedLimitItem(),
            defaultLimitSpeed: 300,
            limitSpeed: 0,
            linkId: '1234567890',
            roadClass: 'expressway',
          },
        ]),
      ).success,
    ).toBe(true);
  });

  it('rejects out-of-range VSL speeds and unsupported inferred meanings', () => {
    const target = schema('variableSpeedLimitSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    expect(
      target.safeParse(snapshot('variable-speed-limits', [{ ...speedLimitItem(), limitSpeed: 301 }])).success,
    ).toBe(false);
    expect(
      target.safeParse(snapshot('variable-speed-limits', [{ ...speedLimitItem(), speedUnit: 'km/h' }])).success,
    ).toBe(false);
    expect(
      target.safeParse(snapshot('variable-speed-limits', [{ ...speedLimitItem(), restrictionState: 'active' }]))
        .success,
    ).toBe(false);
    expect(
      target.safeParse(snapshot('variable-speed-limits', [{ ...speedLimitItem(), lifecycle: 'active' }])).success,
    ).toBe(false);
  });

  it('rejects cross-channel payloads rather than accepting a broad item union', () => {
    const vms = schema('vmsGuidanceSnapshotSchema');
    const safety = schema('safetyNoticeSnapshotSchema');
    const speedLimit = schema('variableSpeedLimitSnapshotSchema');
    expect(vms).toBeDefined();
    expect(safety).toBeDefined();
    expect(speedLimit).toBeDefined();
    if (vms === undefined || safety === undefined || speedLimit === undefined) return;

    expect(vms.safeParse(snapshot('vms', [safetyItem()])).success).toBe(false);
    expect(safety.safeParse(snapshot('safety-notices', [speedLimitItem()])).success).toBe(false);
    expect(speedLimit.safeParse(snapshot('variable-speed-limits', [vmsItem()])).success).toBe(false);
    expect(vms.safeParse(snapshot('safety-notices', [vmsItem()])).success).toBe(false);
  });

  it('enforces unique IDs and deterministic ascending item order for every channel', () => {
    const cases = [
      [schema('vmsGuidanceSnapshotSchema'), 'vms', vmsItem(vmsId('1')), vmsItem(vmsId('2'))],
      [schema('safetyNoticeSnapshotSchema'), 'safety-notices', safetyItem(safetyId('1')), safetyItem(safetyId('2'))],
      [
        schema('variableSpeedLimitSnapshotSchema'),
        'variable-speed-limits',
        speedLimitItem(speedLimitId('1')),
        speedLimitItem(speedLimitId('2')),
      ],
    ] as const;

    for (const [target, channel, first, second] of cases) {
      expect(target).toBeDefined();
      if (target === undefined) continue;
      expect(target.safeParse(snapshot(channel, [first, second])).success).toBe(true);
      expect(target.safeParse(snapshot(channel, [second, first])).success).toBe(false);
      expect(target.safeParse(snapshot(channel, [first, first])).success).toBe(false);
    }
  });

  it('enforces channel-specific item count ceilings without truncation', () => {
    const vms = schema('vmsGuidanceSnapshotSchema');
    const safety = schema('safetyNoticeSnapshotSchema');
    const speedLimit = schema('variableSpeedLimitSnapshotSchema');
    expect(vms).toBeDefined();
    expect(safety).toBeDefined();
    expect(speedLimit).toBeDefined();
    if (vms === undefined || safety === undefined || speedLimit === undefined) return;

    const makeSuffix = (index: number) => index.toString(36).padStart(32, '0');
    expect(
      vms.safeParse(
        snapshot(
          'vms',
          Array.from({ length: 2_501 }, (_, index) => vmsItem(vmsId(makeSuffix(index)))),
        ),
      ).success,
    ).toBe(false);
    expect(
      safety.safeParse(
        snapshot(
          'safety-notices',
          Array.from({ length: 2_501 }, (_, index) => safetyItem(safetyId(makeSuffix(index)))),
        ),
      ).success,
    ).toBe(false);
    expect(
      speedLimit.safeParse(
        snapshot(
          'variable-speed-limits',
          Array.from({ length: 5_001 }, (_, index) => speedLimitItem(speedLimitId(makeSuffix(index)))),
        ),
      ).success,
    ).toBe(false);
  });

  it('enforces the two MiB serialized snapshot boundary', () => {
    const target = schema('safetyNoticeSnapshotSchema');
    expect(target).toBeDefined();
    if (target === undefined) return;

    const message = '가'.repeat(1_500);
    const items = Array.from({ length: 500 }, (_, index) => ({
      ...safetyItem(safetyId(index.toString(36).padStart(32, '0'))),
      message,
    }));
    expect(new TextEncoder().encode(JSON.stringify(snapshot('safety-notices', items))).byteLength).toBeGreaterThan(
      2 * 1024 * 1024,
    );
    expect(target.safeParse(snapshot('safety-notices', items)).success).toBe(false);
  });
});
