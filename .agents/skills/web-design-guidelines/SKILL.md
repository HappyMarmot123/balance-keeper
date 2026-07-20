---
name: web-design-guidelines
description: Use when building or restyling any UI, page, panel, map control, or media view in this project. Covers accessibility, desktop-first dashboard layout, loading and degraded states, data density, dark-mode contrast, and semantic HTML. Apply alongside frontend-design.
---

# Web Design Guidelines

Use frontend-design for aesthetic identity. Use this skill as the non-negotiable quality floor for every user-facing view.

## Represent the full data lifecycle

Every data view handles:

- Loading with stable layout feedback
- Error with a useful cause and retry when retry is possible
- Empty with a clear explanation or next action
- Stale or partial data with visible age and degraded-source status
- Success with upstream fetchedAt or equivalent source freshness

Add disabled and missing-credential states when a capability can be unavailable by policy or configuration. Do not use TanStack Query's client update time as a substitute for upstream data freshness.

## Meet the quality floor

- Use semantic elements, visible focus, and accessible names for icon-only controls.
- Never use color as the only status signal; pair it with text or an icon.
- Check contrast on the actual composed background: 4.5:1 for normal text, 3:1 for large text, and 3:1 for interactive boundaries and focus indicators.
- Use approved semantic OKLCH tokens; do not hardcode visual values in component markup.
- Prioritize the desktop dashboard while keeping narrow screens free of clipping, inaccessible controls, and forced two-dimensional scrolling.
- Let content and container space determine grid changes instead of applying one fixed breakpoint recipe everywhere.
- Respect prefers-reduced-motion and stop non-essential animation.
- Lead with the current number, status, and freshness; keep labels and chrome secondary.

## Make maps and media operable

- Make layer controls and data selectors keyboard operable.
- Provide a list or detail alternative for information available only through map markers.
- Give map controls and marker actions accessible names.
- For CCTV or other dialogs, trap focus, close on Escape, and return focus to the trigger.
- Never make hover the only way to reach critical information.

## Review failure modes

Reject happy-path-only panels, stale data presented as fresh, color-only alerts, low-contrast dark overlays, unlabelled controls, overflowing narrow layouts, and dialogs that lose keyboard focus.
