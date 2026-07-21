// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const expectedBoundaries = [
  {
    file: 'src/server/cache/index.ts',
    exports: ['canonicalJson', 'createCacheKey', 'createWeakEtag', 'MemoryFleetStateStore'],
  },
  {
    file: 'src/server/resilience/index.ts',
    exports: ['createLocalCoalescer', 'withTimeout'],
  },
  {
    file: 'src/server/observability/index.ts',
    exports: ['safeLog'],
  },
  {
    file: 'src/server/http/index.ts',
    exports: ['matchesIfNoneMatch', 'createApiResponse'],
  },
  {
    file: 'src/server/gateway/index.ts',
    exports: ['createGatewayHandler', 'createRouteRegistry'],
  },
] as const;

describe('T06 server public boundaries', () => {
  it('exposes the approved cache, resilience, HTTP, observability, and gateway entry points', () => {
    const violations = expectedBoundaries.flatMap(({ file, exports }) => {
      const absolutePath = resolve(process.cwd(), file);

      if (!existsSync(absolutePath)) {
        return [`${file}: missing public boundary`];
      }

      const source = readFileSync(absolutePath, 'utf8');

      return exports.flatMap((exportName) =>
        new RegExp(`\\b${exportName}\\b`).test(source) ? [] : [`${file}: missing ${exportName}`],
      );
    });

    expect(violations).toEqual([]);
  });
});
