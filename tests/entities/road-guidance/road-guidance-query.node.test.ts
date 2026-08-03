// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

const modulePath = '../../../src/entities/road-guidance/index.ts';
let roadGuidance: Readonly<Record<string, unknown>> = {};

beforeAll(async () => {
  if (existsSync(resolve(process.cwd(), 'src/entities/road-guidance/index.ts'))) {
    roadGuidance = (await import(/* @vite-ignore */ modulePath)) as Readonly<Record<string, unknown>>;
  }
});

type QueryOptions = Readonly<{
  enabled: boolean;
  queryFn(context: Readonly<{ signal: AbortSignal }>): Promise<unknown>;
  queryKey: readonly unknown[];
  refetchInterval: number | false;
  staleTime: number;
}>;

type CreateQueryOptions = (dependencies?: Readonly<{ enabled?: boolean; fetcher?: typeof fetch }>) => QueryOptions;

const generatedAt = Date.parse('2026-08-03T12:05:00+09:00');
const envelope = (channel: 'safety-notices' | 'variable-speed-limits' | 'vms') => ({
  data: { channel, generatedAt, items: [] },
  meta: {
    cache: 'MISS',
    fetchedAt: generatedAt,
    requestId: `road-guidance-${channel}-query`,
    source: 'ITS',
  },
});

describe('road guidance query options', () => {
  it.each([
    ['vmsGuidanceQueryOptions', 'VMS_GUIDANCE_QUERY_PROFILE', 'vms', '/api/road-guidance/vms', 2 * 60_000],
    [
      'safetyNoticeQueryOptions',
      'SAFETY_NOTICE_QUERY_PROFILE',
      'safety-notices',
      '/api/road-guidance/safety-notices',
      5 * 60_000,
    ],
    [
      'variableSpeedLimitQueryOptions',
      'VARIABLE_SPEED_LIMIT_QUERY_PROFILE',
      'variable-speed-limits',
      '/api/road-guidance/variable-speed-limits',
      5 * 60_000,
    ],
  ] as const)(
    'keeps %s disabled with an independent cadence and provider-free endpoint',
    async (factoryName, profileName, channel, endpoint, cadence) => {
      const createOptions = roadGuidance[factoryName] as CreateQueryOptions | undefined;
      const profile = roadGuidance[profileName] as Record<string, unknown> | undefined;
      expect(createOptions).toBeTypeOf('function');
      expect(profile).toMatchObject({
        refetchInterval: cadence,
        refetchIntervalInBackground: false,
        staleTime: cadence,
      });
      if (createOptions === undefined) return;

      const responseEnvelope = envelope(channel);
      const fetcher = vi.fn(async () => Response.json(responseEnvelope));
      const controller = new AbortController();
      const options = createOptions({ fetcher });

      expect(options.enabled).toBe(false);
      expect(options.queryKey).toEqual(['road-guidance', channel]);
      await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual(responseEnvelope);
      expect(fetcher).toHaveBeenCalledWith(
        endpoint,
        expect.objectContaining({ method: 'GET', redirect: 'error', signal: controller.signal }),
      );
    },
  );

  it('supports explicit T30 activation independently for each channel', () => {
    for (const factoryName of [
      'vmsGuidanceQueryOptions',
      'safetyNoticeQueryOptions',
      'variableSpeedLimitQueryOptions',
    ]) {
      const createOptions = roadGuidance[factoryName] as CreateQueryOptions | undefined;
      expect(createOptions).toBeTypeOf('function');
      if (createOptions !== undefined) {
        expect(createOptions({ enabled: true }).enabled).toBe(true);
      }
    }
  });

  it.each([
    ['vmsGuidanceQueryOptions', 'vms', 'safety-notices'],
    ['safetyNoticeQueryOptions', 'safety-notices', 'variable-speed-limits'],
    ['variableSpeedLimitQueryOptions', 'variable-speed-limits', 'vms'],
  ] as const)('rejects a cross-channel response in %s', async (factoryName, _expected, wrongChannel) => {
    const createOptions = roadGuidance[factoryName] as CreateQueryOptions | undefined;
    expect(createOptions).toBeTypeOf('function');
    if (createOptions === undefined) return;

    const fetcher = vi.fn(async () => Response.json(envelope(wrongChannel)));
    await expect(
      createOptions({ enabled: true, fetcher }).queryFn({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
