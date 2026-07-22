# Balance Keeper Repository Instructions

This repository rebuilds the Korea-focused real-time public-signal dashboard from a clean foundation.

## Authority and approval

docs/PROJECT-JOURNAL.md is the single source of truth for product decisions, Task scope, status, evidence, and regression results. The current execution mode is recorded there.

- PROPOSED is not authorization.
- Start a Task only when it is APPROVED and every dependency is ACCEPTED.
- In approval mode, work on one Task at a time. Do not begin the next Task before the user accepts the current result.
- A material scope or decision change requires renewed approval.
- PASS means required verification succeeded; it does not mean ACCEPTED.
- Only the user grants APPROVED or ACCEPTED and decides whether work is merged.
- Mark unresolved conflicts, missing information, failed validation, unverified critical paths, or known regressions BLOCKED. Record the release condition and stop instead of guessing.

The main agent serializes journal edits. Subagents may perform bounded research inside the active Task, but the main agent must verify their findings. Skill instructions never expand the approved scope; these approval rules override any generic instruction to commit.

## Development workflow

After approval, use:

    brainstorm → plan → RED → GREEN → REFACTOR → verify → review

Record Task-specific normal, failure, boundary, and regression evidence in the journal. APPROVED authorizes scoped edits and verification. In approval mode, wait for ACCEPTED before the final commit. A checkpoint commit is allowed only for an IN_PROGRESS Task after the user explicitly identifies that Task and requests an intermediate snapshot. Push or deploy only when explicitly requested.

## Pull request and code review

- Develop each approved feature on a `feature/*` branch and open its pull request against `development`.
- Keep one change purpose per pull request and record its Task ID, verification evidence, regression risk, and unverified paths.
- 병합 전 `quality-gate` 통과는 필수다. Codex 리뷰는 참고 의견이며, 사람의 최종 승인만 병합 여부와 Task `ACCEPTED`를 결정한다.
- 자동 리뷰는 변경분만 검토하고 재현 가능한 문제만 보고한다. 취향과 단순 포맷, 근거 없는 추측, 불필요한 칭찬이나 요약은 제외한다.
- Review readability, predictability, cohesion, coupling, security, accessibility, performance, regression risk, and the Full FSD dependency direction.
- A review reports findings but does not modify code, approve, merge, commit, push, expose secrets, or expand the approved Task scope.

## Runtime and language baseline

- Node.js 24 and npm 11
- TypeScript in strict mode
- Preact, @preact/signals, and @tanstack/preact-query
- Vite and Tailwind CSS
- Vitest and Testing Library
- Vercel as the deployment target

Use Preact-native packages first. Do not add React, ReactDOM, @tanstack/react-query, or a compatibility layer without an approved integration need.

## Full FSD architecture

Client imports flow downward:

    app → pages → widgets → features → entities → shared

- app owns entry, providers, global boundaries, and global initialization.
- pages composes complete screens from widget public APIs.
- widgets own meaningful screen regions and their view states.
- features express user actions.
- entities own domain concepts, basic rules, and reusable representations.
- shared contains domain-agnostic UI and infrastructure.
- Do not import upward, between sibling slices, or through another slice's internals.
- Expose each slice through index.ts.
- Keep pages composition-only; queries, signals, and business policy belong below them.
- Use pages/dashboard without a router until a separately approved second URL exists.
- Keep client code separate from api and src/server.

TanStack Query owns remote server state. Signals own only derived or transient UI state.

NAVER Maps GL is the primary map. Lazy-load the map SDK, HLS, charts, workers, and large geographic data. Do not add an alternate map engine without a separately approved, measured need.

## Required skills

Read every matching skill completely before acting:

- Task proposal, decomposition, status, scope, dependency, approval, BLOCKED handling, or journal changes: .agents/skills/planning-agent/SKILL.md
- Any feature implementation or bug fix: .agents/skills/test-driven-development/SKILL.md
- Vitest, component, query, or fetcher testing: .agents/skills/testing-tdd-vitest/SKILL.md
- Client file placement, imports, public APIs, or architecture review: .agents/skills/full-fsd-architecture/SKILL.md
- Any UI work: both .agents/skills/frontend-design/SKILL.md and .agents/skills/web-design-guidelines/SKILL.md
- Tailwind, tokens, or theme mechanics: .agents/skills/styling-tailwind/SKILL.md
- Vercel routes or public-data fetchers: .agents/skills/vercel-api-gateway/SKILL.md

## Delivery and security gate

Run Task-specific checks and npm run validate before declaring PASS. Tests are deterministic and offline unless a live smoke suite is explicitly approved and gated.

Never copy, print, or commit values from local .env files. Only VITE_* identifiers may be exposed to browser code; provider credentials remain server-side.
