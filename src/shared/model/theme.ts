import type { ReadonlySignal, Signal } from '@preact/signals';
import { computed, signal } from '@preact/signals';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export type ThemeModel = {
  preference: Signal<ThemePreference>;
  resolved: ReadonlySignal<ResolvedTheme>;
  setPreference: (preference: ThemePreference) => void;
  setSystemTheme: (theme: ResolvedTheme) => void;
};

export function createThemeModel(
  initialPreference: ThemePreference = 'system',
  initialSystemTheme: ResolvedTheme = 'light',
): ThemeModel {
  const preference = signal<ThemePreference>(initialPreference);
  const systemTheme = signal<ResolvedTheme>(initialSystemTheme);
  const resolved = computed<ResolvedTheme>(() =>
    preference.value === 'system' ? systemTheme.value : preference.value,
  );

  return {
    preference,
    resolved,
    setPreference(nextPreference) {
      preference.value = nextPreference;
    },
    setSystemTheme(theme) {
      systemTheme.value = theme;
    },
  };
}

export const themeModel = createThemeModel();
