import { effect } from '@preact/signals';
import type { ThemeModel, ThemePreference } from '../../shared/model';
import { themeModel } from '../../shared/model';

const THEME_STORAGE_KEY = 'balance-keeper:theme';
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

type ThemeMediaChangeListener = (event: { matches: boolean }) => void;

export type ThemeRoot = {
  classList: {
    toggle: (token: string, force?: boolean) => unknown;
  };
  style: {
    colorScheme: string;
  };
};

export type ThemeStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type ThemeMediaQuery = {
  addEventListener: (type: 'change', listener: ThemeMediaChangeListener) => void;
  matches: boolean;
  removeEventListener: (type: 'change', listener: ThemeMediaChangeListener) => void;
};

export type ThemeEnvironment = {
  matchMedia?: (query: string) => ThemeMediaQuery;
  root: ThemeRoot;
  storage?: ThemeStorage;
};

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readStoredPreference(storage: ThemeStorage | undefined): ThemePreference | undefined {
  try {
    const storedPreference = storage?.getItem(THEME_STORAGE_KEY) ?? null;
    return isThemePreference(storedPreference) ? storedPreference : undefined;
  } catch {
    return undefined;
  }
}

function readSystemMedia(environment: ThemeEnvironment): ThemeMediaQuery | undefined {
  try {
    return environment.matchMedia?.(DARK_MODE_QUERY);
  } catch {
    return undefined;
  }
}

export function initializeTheme(environment: ThemeEnvironment, model: ThemeModel = themeModel): () => void {
  const systemMedia = readSystemMedia(environment);

  model.setSystemTheme(systemMedia?.matches ? 'dark' : 'light');
  model.setPreference(readStoredPreference(environment.storage) ?? 'system');

  const handleSystemChange: ThemeMediaChangeListener = (event) => {
    model.setSystemTheme(event.matches ? 'dark' : 'light');
  };

  systemMedia?.addEventListener('change', handleSystemChange);

  const disposeRootEffect = effect(() => {
    const resolvedTheme = model.resolved.value;

    environment.root.classList.toggle('dark', resolvedTheme === 'dark');
    environment.root.style.colorScheme = resolvedTheme;
  });
  let hasObservedInitialPreference = false;
  const disposeStorageEffect = effect(() => {
    const preference = model.preference.value;

    if (!hasObservedInitialPreference) {
      hasObservedInitialPreference = true;
      return;
    }

    try {
      environment.storage?.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // A blocked storage backend must not prevent theme changes.
    }
  });

  return () => {
    systemMedia?.removeEventListener('change', handleSystemChange);
    disposeRootEffect();
    disposeStorageEffect();
  };
}
