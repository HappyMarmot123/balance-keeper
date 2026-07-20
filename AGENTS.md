# Korea Monitor — Project Instructions

This repository rebuilds the Korea-focused real-time public-signal dashboard from a clean foundation.

## Runtime and language baseline

- Node.js 24 and npm 11
- TypeScript in strict mode
- Preact, `@preact/signals`, and `@tanstack/preact-query`
- Vite and Tailwind CSS
- Vitest and Testing Library
- Vercel as the deployment target

Use Preact-native packages first. Do not add `@tanstack/react-query`, React, or ReactDOM unless a reviewed third-party integration requires the compatibility layer.

## Architecture baseline

Client imports flow downward:

```text
app → widgets → features → entities → shared
```

- Keep domain types, queries, and UI inside the matching entity slice.
- Keep external API calls behind server-side API routes.
- Do not put remote server data in signals; TanStack Query owns it.
- Signals own only transient client UI state.
- Do not add a router until product navigation has been explicitly decided.
- Load maps, media players, and large geographic datasets with dynamic imports only when activated.

## Skills

Read the matching skill before acting:

- Any implementation or bug fix: `.agents/skills/test-driven-development/SKILL.md`
- Vitest/component/fetcher testing: `.agents/skills/testing-tdd-vitest/SKILL.md`
- File placement and imports: `.agents/skills/fsd-lite-architecture/SKILL.md`
- UI work: both `.agents/skills/frontend-design/SKILL.md` and `.agents/skills/web-design-guidelines/SKILL.md`
- Tailwind styling and theme mechanics: `.agents/skills/styling-tailwind/SKILL.md`
- Vercel routes or public-data fetchers: `.agents/skills/vercel-api-gateway/SKILL.md`

The legacy `preact-signals-query` and `map-deckgl-maplibre` skills are intentionally not installed yet. They target `@tanstack/react-query` and an eager deck.gl architecture that this rebuild does not adopt.

## Delivery gate

Run `npm run validate` before declaring work complete. Tests must be deterministic and offline unless a live smoke suite is explicitly gated.

Never copy or print values from a local `.env`. Only `VITE_*` identifiers may be exposed to browser code.
