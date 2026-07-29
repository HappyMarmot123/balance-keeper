// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('T16 disaster alert public boundaries', () => {
  it('provides the approved entity, provider, route and widget entrypoints', () => {
    const requiredFiles = [
      'src/entities/disaster/index.ts',
      'src/server/providers/safetydata/index.ts',
      'src/server/routes/disaster/index.ts',
      'src/widgets/disaster/index.ts',
      'src/widgets/disaster/ui/DisasterView.tsx',
      'src/widgets/disaster/ui/DisasterWidget.tsx',
    ];

    expect(requiredFiles.filter((file) => !existsSync(resolve(root, file)))).toEqual([]);
  });
});
