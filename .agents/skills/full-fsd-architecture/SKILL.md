---
name: full-fsd-architecture
description: Apply this project's Full FSD architecture. Use whenever creating, moving, or reviewing client-side files; deciding layer, slice, or segment ownership; adding a page, widget, feature, or entity; changing imports or public APIs; or planning a client architecture refactor under src.
---

# Full FSD Architecture

## Preserve the layer direction

Use this client dependency flow:

    app → pages → widgets → features → entities → shared

Import only from a lower layer. Do not import directly between sibling slices in the same layer. Compose sibling behavior in a higher layer, or move only genuinely domain-agnostic code to shared.

## Assign one product responsibility

- app: entry point, providers, global error boundary, theme initialization, and global styles
- pages: complete screen composition exposed to app
- widgets: independent, meaningful screen regions that finish their own view states
- features: user actions and interaction policies
- entities: domain types, basic rules, state representation, and reusable domain UI
- shared: design-system primitives, browser-safe infrastructure, configuration, and utilities that know no product domain

Start with pages/dashboard and let app compose DashboardPage. A page composes widget public APIs; it does not own queries, signals, or business policy. Do not add a router until a separately approved requirement introduces a second real URL.

Use optional ui, model, lib, and api segments when they clarify responsibility. Do not create empty folders or force every slice into the same shape.

Keep reusable domain query options, normalization, and fetchers with the owning entity. Keep action-specific mutations and policies with the owning feature. Let widgets consume those public APIs and finish loading, error, empty, stale, and success views. This is a responsibility guide, not a mandatory folder template.

When visible parts need the same transient interaction state, first decide whether they form one cohesive region. If they do, keep them as internal components of one widget slice rather than sibling widget slices. Keep purely local coordination state in that widget's model; extract it to a feature only when the action or policy is independently reusable. If the parts remain independent widgets, both may consume a lower feature public API, but they never import each other and the page still owns no state.

## Protect public APIs

Expose each slice through index.ts. Code outside the slice imports that public API, never slice/ui, slice/model, or another internal path. Relative internal imports are allowed within the same slice.

Do not collect unrelated domain models in a global type file. Keep domain view models near their entity or feature. Share only browser-safe transport contracts when client and server genuinely require the same shape.

## Keep state and runtime boundaries clear

- Use native @tanstack/preact-query for remote server state, polling, retries, stale time, and request deduplication.
- Use @preact/signals for derived and transient client UI state.
- Distinguish a slice's api segment from the root serverless api directory. Keep root api and src/server outside the client layer graph; client modules never import server runtime code.
- Route external-provider calls through server-side gateways. Never expose provider secrets in browser code.

NAVER Maps GL is the primary map. Its browser SDK asset and explicitly public client identifier or style identifier are allowed in client configuration; provider data APIs and secrets still go through the gateway. Load the SDK, HLS playback, charts, workers, and large geographic data only at the activation boundary defined by the Task, such as viewport entry, tab opening, or explicit interaction. Do not introduce React adapters, a router, MapLibre, or deck.gl without a separately approved Task.

## Review every client change

Before finishing:

1. Identify the owning layer and slice from product responsibility.
2. Check every import flows downward and avoids sibling and deep imports.
3. Confirm the public API is the smallest surface required.
4. Confirm pages remain composition-only and state has the correct owner.
5. Check heavy browser capabilities stay behind a lazy boundary.

Reject upward imports, sibling slice imports, deep imports, domain dumping into shared, server data stored in signals, eager heavy dependencies, and direct browser calls to protected providers.
