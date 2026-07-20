---
name: testing-tdd-vitest
description: Use when implementing any feature, server fetcher, query behavior, or component in this project, before implementation code. Covers the RED-GREEN-REFACTOR loop with Vitest, offline fixtures, injected adapters, and jsdom Preact tests.
---

# Testing with Vitest

Read .agents/skills/test-driven-development/SKILL.md first for the full RED-GREEN-REFACTOR discipline. This skill adds project-specific Vitest and Preact practices.

## Run the loop

1. **RED:** Write one test for the next observable behavior. Run it and confirm it fails for the intended reason rather than a setup error.
2. **GREEN:** Add the smallest implementation that passes.
3. **REFACTOR:** Improve names and structure while the test remains green.
4. **VERIFY:** Run focused tests, relevant regression tests, and npm run validate.

Commit and push only when the Planning Agent approval rules permit them.

## Test at the right boundary

- Test source normalizers and fetchers with realistic upstream fixtures and injected HTTP/cache adapters.
- Assert the normalized domain or transport contract, not incidental raw provider JSON.
- Keep default tests deterministic and offline. Put credentialed live smoke checks behind a separately approved environment gate.
- Use jsdom and @testing-library/preact for component behavior and accessibility.
- Test query integrations when query keys, enabled, polling profiles, cancellation, or focus/visibility recovery are important behavior.
- Prefer observable outcomes over internal implementation details and fragile module mocks.

For data UI, cover loading, error, empty, stale/partial, and success. Also cover disabled or missing-credential states when the capability supports them. Verify accessible names and user actions rather than Tailwind classes.

## Prevent false confidence

- Do not write implementation before observing RED.
- Do not accept a test that fails because imports, fixtures, or the environment are broken.
- Do not hit production providers from the normal suite.
- Do not declare PASS when a required path is untested, a test fails, or a known regression remains.
