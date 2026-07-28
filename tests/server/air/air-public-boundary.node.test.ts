// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const airKoreaProviderPublicApi = resolve(process.cwd(), 'src/server/providers/airkorea/index.ts');
const airRoutePublicApi = resolve(process.cwd(), 'src/server/routes/air/index.ts');

describe('AirKorea server boundary', () => {
  it('owns one provider public entrypoint', () => {
    expect(existsSync(airKoreaProviderPublicApi), 'src/server/providers/airkorea/index.ts must exist').toBe(true);
  });

  it('owns one route public entrypoint without adding another Vercel function', () => {
    expect(existsSync(airRoutePublicApi), 'src/server/routes/air/index.ts must exist').toBe(true);
  });
});
