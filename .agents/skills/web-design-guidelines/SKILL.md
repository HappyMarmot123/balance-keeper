---
name: web-design-guidelines
description: Use when building or restyling any UI, page, panel, or component in this project — covers accessibility, responsive layout, loading/error/empty states, dashboard data density, dark-mode contrast, and semantic HTML. Default-applied alongside frontend-design.
---

# Web Design Guidelines

## Overview
Enforceable UX-quality baseline for the Korea Monitor single-page dashboard. **frontend-design owns the aesthetic identity** (palette, typography, signature); this skill owns the **non-negotiable quality floor** every panel must clear. Both are default-applied to all UI work.

## When to Use
- Building a new panel/component or restyling an existing one
- Reviewing UI before calling it done
- Deciding loading / error / empty behavior

## Quality Floor (every component clears all)
| Area | Rule |
|---|---|
| **States** | Every data view has 4 states: loading (skeleton/spinner), error (cause + retry), empty (actionable invitation), data. Never render bare `undefined`. |
| **Freshness** | Time-sensitive panels show a freshness badge (relative time from `fetchedAt`) and a "지연/stale" marker when serving stale-on-error data. |
| **Accessibility** | Semantic HTML (`<button>`, `<nav>`, `<section>`), visible keyboard focus, `aria-label` on icon-only controls, color never the sole signal (pair with text/icon). |
| **Responsive** | Mobile-first. Grid collapses `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`. No fixed pixel widths that overflow on 360px. |
| **Dark mode** | Support light+dark via `dark:` variants. Verify text contrast ≥ 4.5:1 in BOTH themes. |
| **Motion** | Respect `prefers-reduced-motion`; disable non-essential animation when set. |
| **Density** | Dashboard = scannable. Lead with the number/status; label secondary. Align numeric columns. Don't bury the current value under chrome. |

## Panel state template
```tsx
// Every domain panel routes through these 4 states (see preact-signals-query for the hook)
function WeatherPanel() {
  const { data, isLoading, error, dataUpdatedAt } = useWeather(region);
  return (
    <Panel title="기상" isLoading={isLoading} error={error} fetchedAt={dataUpdatedAt}>
      {data?.length
        ? <WeatherCards items={data} />
        : <Empty>표시할 관측값이 없습니다.</Empty>}  {/* empty = invitation, not blank */}
    </Panel>
  );
}
```

## Common Mistakes
- **Only the happy path.** Shipping data state but no loading/error/empty → blank flicker and silent failures.
- **Color-only status.** Red/green dot with no text fails colorblind users and dark mode.
- **Stale shown as fresh.** Serving cached data on upstream error without a "지연" marker misleads.
- **Aesthetics in this skill.** Palette/typography decisions belong to frontend-design — don't relitigate them here.
