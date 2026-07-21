// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('NAVER Maps production loader boundary', () => {
  it('exposes one shared production entrypoint without exposing the injectable factory', () => {
    const publicApi = readFileSync(resolve(process.cwd(), 'src/entities/map/index.ts'), 'utf8');

    expect(publicApi).toContain('getNaverMapsGlLoader');
    expect(publicApi).not.toMatch(/export\s*\{[^}]*\bcreateNaverMapsGlLoader\b/);
  });

  it('makes the production widget consume the shared entrypoint instead of owning another loader cache', () => {
    const widget = readFileSync(resolve(process.cwd(), 'src/widgets/korea-map/ui/KoreaMapWidget.tsx'), 'utf8');

    expect(widget).toContain('getNaverMapsGlLoader');
    expect(widget).not.toMatch(/let\s+browserLoader\b/);
  });
});
