// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

describe('weather alert slice presence', () => {
  it('owns a model, server-safe contract and browser public API', () => {
    expect(existsSync(resolve(workspaceRoot, 'src/entities/weather-alert/model/weatherAlert.ts'))).toBe(true);
    expect(existsSync(resolve(workspaceRoot, 'src/entities/weather-alert/contract.ts'))).toBe(true);
    expect(existsSync(resolve(workspaceRoot, 'src/entities/weather-alert/index.ts'))).toBe(true);
  });
});
