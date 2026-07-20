---
name: testing-tdd-vitest
description: Use when implementing any feature, server fetcher, or component in this project, before writing implementation code. Covers the TDD loop with Vitest, fixture-based source tests, and jsdom component tests.
---

# Testing: TDD with Vitest

## Overview
TDD is mandatory: write the failing test first, watch it fail, write minimal code to pass, refactor. This project uses **Vitest** (+ jsdom and `@testing-library/preact` for components). **REQUIRED BACKGROUND:** superpowers:test-driven-development for the full RED-GREEN-REFACTOR discipline.

## The loop (per task)
1. **RED** — write the test for the next behavior; run it; confirm it fails for the right reason.
2. **GREEN** — minimal implementation to pass.
3. **REFACTOR** — clean up with tests green.
4. Commit.

## Server fetcher test (fixture + mocked http/redis)
```ts
import { vi } from 'vitest';
vi.mock('../../src/server/http', async (o) => ({ ...(await o()), getJson: vi.fn().mockResolvedValue(fixture) }));
vi.mock('../../src/server/redis', () => ({
  cachedFetch: async (_k: string, _t: number, f: () => Promise<unknown>) =>
    ({ data: await f(), cached: false, fetchedAt: 1 }),
}));

test('fetchWeather maps KMA fields to domain shape', async () => {
  const { fetchWeather } = await import('../../src/server/sources/weather');
  expect(await fetchWeather('seoul')).toMatchObject([{ region: 'seoul', tmp: expect.any(Number) }]);
});
```

## Component test (jsdom)
```ts
// vite.config: test.environment = 'jsdom'
import { render, screen } from '@testing-library/preact';
test('Panel renders retry button on error', () => {
  render(<Panel title="x" isLoading={false} error={new AppError('UPSTREAM_UNAVAILABLE')} />);
  expect(screen.getByRole('button', { name: /재시도/ })).toBeTruthy();
});
```

## Rules
- **Source/fetcher tests** mock `http` (with a real upstream fixture) and `redis` — assert the normalized domain shape, not the raw upstream JSON.
- **Component tests** assert the 4 states (loading/error/empty/data — see web-design-guidelines), not styling.
- Query hooks are verified at integration; unit-test the fetchers and components.
- Gate: `npx tsc --noEmit && npx vitest run && npx vite build` before declaring done.

## Common Mistakes
- **Test after code.** Tests that pass immediately prove nothing about intent. Write them first.
- **Asserting raw upstream JSON.** Test the normalized shape your domain consumes.
- **Hitting the network.** Use fixtures + mocks; tests must be deterministic and offline.
