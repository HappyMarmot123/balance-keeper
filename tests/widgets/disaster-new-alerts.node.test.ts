// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { DisasterAlert } from '../../src/entities/disaster';
import * as disasterWidgetModule from '../../src/widgets/disaster/ui/DisasterWidget';

const disasterWidget = disasterWidgetModule as Record<string, unknown>;

const alert = (id: string, issuedAt: number): DisasterAlert => ({
  disasterType: '호우',
  emergencyStep: '긴급재난',
  id,
  issuedAt,
  message: `원문 ${id}`,
  regionText: '서울특별시',
});

describe('disaster new-arrival policy', () => {
  it('ignores the first or stale snapshot and announces only genuinely newer unseen ids', () => {
    const derive = disasterWidget.deriveNewDisasterAlertIds as
      | ((
          previous: readonly DisasterAlert[] | undefined,
          next: readonly DisasterAlert[],
          cache: 'HIT' | 'MISS' | 'STALE',
        ) => readonly string[])
      | undefined;
    expect(derive).toBeTypeOf('function');
    if (derive === undefined) {
      return;
    }

    const baseline = [alert('9003', 300), alert('9002', 200)];
    const next = [alert('9004', 400), ...baseline, alert('8000', 100)];

    expect(derive(undefined, baseline, 'MISS')).toEqual([]);
    expect(derive(baseline, next, 'HIT')).toEqual(['9004']);
    expect(derive(baseline, next, 'STALE')).toEqual([]);
    expect(derive(baseline, [...baseline, alert('8000', 100)], 'MISS')).toEqual([]);
  });
});
