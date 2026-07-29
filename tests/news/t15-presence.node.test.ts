// @vitest-environment node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const expectedFiles = [
  'src/entities/news/contract.ts',
  'src/entities/news/model/news.ts',
  'src/entities/news/api/newsQuery.ts',
  'src/entities/news/index.ts',
  'src/server/providers/public-press/publicPressFeed.ts',
  'src/server/providers/public-press/index.ts',
  'src/server/routes/news/newsRoute.ts',
  'src/server/routes/news/index.ts',
  'src/widgets/news/ui/NewsView.tsx',
  'src/widgets/news/ui/NewsWidget.tsx',
  'src/widgets/news/index.ts',
] as const;

describe('T15 public press vertical slice', () => {
  it('provides the approved entity, provider, route and widget boundaries', () => {
    expect(expectedFiles.filter((path) => !existsSync(resolve(process.cwd(), path)))).toEqual([]);
  });
});
