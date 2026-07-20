---
name: styling-tailwind
description: Use when styling components with Tailwind CSS, defining design tokens, or implementing dark mode in this project. Covers utility-first conventions, token usage, and the signal-driven dark-mode toggle.
---

# Styling with Tailwind

## Overview
Utility-first Tailwind. Visual identity comes from **frontend-design** (palette, type scale); this skill covers the mechanics of applying it consistently. Dark mode is class-based and driven by the `theme` signal.

## Rules
- **Utilities over custom CSS.** Reach for Tailwind classes; add a component only when a pattern repeats. Avoid inline `style={}` and ad-hoc CSS files.
- **Tokens, not magic values.** Use theme tokens (`bg-surface`, `text-muted`, `accent`) defined from the frontend-design palette — never hardcode `#xxxxxx` in markup.
- **Every color pairs with a `dark:` variant.** `bg-white dark:bg-zinc-900`, `text-zinc-900 dark:text-zinc-100`. Verify ≥4.5:1 contrast in both (see web-design-guidelines).
- **Responsive grid via utilities** (mobile-first): `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`.

## Dark mode (class strategy + signal)
```ts
// tailwind: darkMode: 'class', plus @custom-variant dark (&:where(.dark, .dark *));
import { effect } from '@preact/signals';
import { theme } from '../shared/model/ui-store';

// in app bootstrap — toggle <html class="dark"> from the theme signal
effect(() => {
  document.documentElement.classList.toggle('dark', theme.value === 'dark');
});
```
```tsx
<button onClick={() => (theme.value = theme.value === 'dark' ? 'light' : 'dark')}>
  테마
</button>
```

## Common Mistakes
- **Hardcoded hex in className/style.** Breaks theming and frontend-design's token system.
- **Forgetting `dark:`.** Component looks right in one theme, unreadable in the other.
- **Toggling theme per-component.** One central `effect` flips `<html class="dark">`; components only use `dark:` variants.
- **Desktop-first widths.** Start at `grid-cols-1` and add `md:`/`xl:` up.
