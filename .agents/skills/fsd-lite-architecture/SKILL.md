---
name: fsd-lite-architecture
description: Use when creating or moving any client-side file, deciding where code belongs, or importing between modules in this project. Covers the FSD-lite layer rule, domain slices, the no-pages constraint, and import direction.
---

# FSD-Lite Architecture

## Overview
This project uses **Feature-Sliced Design, lite**: vertical domain slices with a one-way import rule, adapted for a routeless single-page dashboard. There is **no `pages` layer** (one `<App/>`, no router).

## Import direction (one-way, enforced)
```
app → widgets → features → entities → shared
```
- Never import upward (e.g. `entities` importing from `widgets`).
- Never import sideways between sibling slices (e.g. `entities/weather` importing `entities/air`). Compose them in a higher layer instead.

## Layer map
```
src/
  shared/    <Panel>, lib (FNV-1a ETag, useNearViewport, theme), api client (typed GET),
             common types, config (regions KR/CN/TW/JP/US, sources, panel/layer defs, market symbols)
  entities/  domain slices: weather/ air/ earthquake/ market/ macro/ disaster/ news/ neighbor/ military/ cctv/
             each slice = { model (types), api (useXxx hook + normalize), ui (XxxPanel) }
  features/  user interactions: cctv-live-viewer (modal + hls.js), layer-toggle, theme-switch
  widgets/   MapView (deck.gl) + PanelGrid (responsive grid composition)
  app/       App.tsx, providers (QueryClientProvider), refresh-scheduler, main.tsx (entry)
api/         Vercel API Routes (server-side — INDEPENDENT of the frontend layer rule)
```

## Slice template
```
src/entities/weather/
  model/types.ts      # WeatherNow, WeatherForecast …
  api/queries.ts      # useWeather(region) — see preact-signals-query
  ui/WeatherPanel.tsx # see web-design-guidelines for state handling
  index.ts            # public surface; other layers import from here only
```
To fix the weather domain you touch exactly one folder — types, fetch, and UI are colocated.

## Rules
- A slice exposes a **public surface** (`index.ts`); other layers import the slice, not its internals.
- Cross-cutting code (Panel, hooks, config, types shared with the server) lives in `shared/`.
- Server code (`src/server/`, `api/`) is separate and not bound by this rule.

## Common Mistakes
- **Adding a `pages` layer or a router.** Violates the one-page constraint — compose in `app/App.tsx` instead.
- **Sibling slice imports.** `entities/market` importing `entities/macro` → lift the shared piece to `shared/` or compose in a widget.
- **Reaching into internals.** Importing `entities/weather/ui/WeatherPanel` directly instead of via the slice's `index.ts`.
- **Dumping everything in `shared/`.** If it's domain-specific, it belongs in that entity slice.
