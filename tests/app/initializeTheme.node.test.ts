// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { initializeTheme } from '../../src/app/theme/initializeTheme';
import type { ThemeModel } from '../../src/shared/model';
import { createThemeModel } from '../../src/shared/model';

type MediaChangeListener = (event: { matches: boolean }) => void;

type TestEnvironment = {
  matchMedia?: (query: string) => {
    addEventListener: (type: 'change', listener: MediaChangeListener) => void;
    matches: boolean;
    removeEventListener: (type: 'change', listener: MediaChangeListener) => void;
  };
  root: {
    classList: { toggle: (token: string, force?: boolean) => unknown };
    style: { colorScheme: string };
  };
  storage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
};

type TargetInitializer = (environment: TestEnvironment, model?: ThemeModel) => () => void;
const initialize = initializeTheme as TargetInitializer;

describe('initializeTheme', () => {
  it('applies a stored explicit preference before the system preference', () => {
    const toggle = vi.fn();
    const storage = {
      getItem: vi.fn(() => 'dark'),
      setItem: vi.fn(),
    };
    const media = {
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    };
    const environment: TestEnvironment = {
      matchMedia: vi.fn(() => media),
      root: { classList: { toggle }, style: { colorScheme: '' } },
      storage,
    };
    const model = createThemeModel();

    initialize(environment, model);

    expect(storage.getItem).toHaveBeenCalledWith('balance-keeper:theme');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(model.preference.value).toBe('dark');
    expect(model.resolved.value).toBe('dark');
    expect(toggle).toHaveBeenLastCalledWith('dark', true);
    expect(environment.root.style.colorScheme).toBe('dark');
  });

  it('keeps a stored light preference above a dark system preference', () => {
    const toggle = vi.fn();
    const environment: TestEnvironment = {
      matchMedia: () => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      }),
      root: { classList: { toggle }, style: { colorScheme: '' } },
      storage: { getItem: vi.fn(() => 'light'), setItem: vi.fn() },
    };
    const model = createThemeModel();

    initialize(environment, model);

    expect(model.preference.value).toBe('light');
    expect(model.resolved.value).toBe('light');
    expect(toggle).toHaveBeenLastCalledWith('dark', false);
  });

  it('follows system changes while the preference remains system', () => {
    let listener: MediaChangeListener | undefined;
    const toggle = vi.fn();
    const media = {
      addEventListener: vi.fn((_type: 'change', nextListener: MediaChangeListener) => {
        listener = nextListener;
      }),
      matches: true,
      removeEventListener: vi.fn(),
    };
    const environment: TestEnvironment = {
      matchMedia: vi.fn(() => media),
      root: { classList: { toggle }, style: { colorScheme: '' } },
      storage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    };
    const model = createThemeModel();

    initialize(environment, model);

    expect(model.preference.value).toBe('system');
    expect(model.resolved.value).toBe('dark');
    expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    listener?.({ matches: false });

    expect(model.resolved.value).toBe('light');
    expect(toggle).toHaveBeenLastCalledWith('dark', false);
    expect(environment.root.style.colorScheme).toBe('light');
  });

  it('persists an explicit preference and keeps it above later system changes', () => {
    let listener: MediaChangeListener | undefined;
    const toggle = vi.fn();
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const media = {
      addEventListener: vi.fn((_type: 'change', nextListener: MediaChangeListener) => {
        listener = nextListener;
      }),
      matches: true,
      removeEventListener: vi.fn(),
    };
    const environment: TestEnvironment = {
      matchMedia: () => media,
      root: { classList: { toggle }, style: { colorScheme: '' } },
      storage,
    };
    const model = createThemeModel();

    initialize(environment, model);
    model.setPreference('light');

    expect(storage.setItem).toHaveBeenLastCalledWith('balance-keeper:theme', 'light');
    expect(model.resolved.value).toBe('light');
    expect(toggle).toHaveBeenLastCalledWith('dark', false);

    listener?.({ matches: true });

    expect(model.preference.value).toBe('light');
    expect(model.resolved.value).toBe('light');
    expect(environment.root.style.colorScheme).toBe('light');
  });

  it('uses the latest system value when an explicit preference returns to system', () => {
    let listener: MediaChangeListener | undefined;
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const media = {
      addEventListener: vi.fn((_type: 'change', nextListener: MediaChangeListener) => {
        listener = nextListener;
      }),
      matches: true,
      removeEventListener: vi.fn(),
    };
    const environment: TestEnvironment = {
      matchMedia: () => media,
      root: { classList: { toggle: vi.fn() }, style: { colorScheme: '' } },
      storage,
    };
    const model = createThemeModel();

    initialize(environment, model);
    model.setPreference('light');
    listener?.({ matches: false });
    model.setPreference('system');

    expect(model.resolved.value).toBe('light');
    expect(storage.setItem).toHaveBeenLastCalledWith('balance-keeper:theme', 'system');

    listener?.({ matches: true });

    expect(model.resolved.value).toBe('dark');
    expect(environment.root.style.colorScheme).toBe('dark');
  });

  it('falls back safely when storage and matchMedia are unavailable', () => {
    const toggle = vi.fn();
    const environment: TestEnvironment = {
      matchMedia: () => {
        throw new Error('matchMedia unavailable');
      },
      root: { classList: { toggle }, style: { colorScheme: '' } },
      storage: {
        getItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => {
          throw new Error('storage blocked');
        },
      },
    };
    const model = createThemeModel('dark', 'dark');

    expect(() => initialize(environment, model)).not.toThrow();
    expect(model.preference.value).toBe('system');
    expect(model.resolved.value).toBe('light');
    expect(toggle).toHaveBeenLastCalledWith('dark', false);

    expect(() => model.setPreference('dark')).not.toThrow();
    expect(environment.root.style.colorScheme).toBe('dark');
  });

  it('treats malformed storage as system preference', () => {
    const environment: TestEnvironment = {
      root: { classList: { toggle: vi.fn() }, style: { colorScheme: '' } },
      storage: { getItem: vi.fn(() => 'sepia'), setItem: vi.fn() },
    };
    const model = createThemeModel('dark', 'dark');

    initialize(environment, model);

    expect(model.preference.value).toBe('system');
    expect(model.resolved.value).toBe('light');
  });

  it('removes listeners and signal effects during cleanup', () => {
    const listeners = new Set<MediaChangeListener>();
    const toggle = vi.fn();
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const media = {
      addEventListener: vi.fn((_type: 'change', listener: MediaChangeListener) => {
        listeners.add(listener);
      }),
      matches: false,
      removeEventListener: vi.fn((_type: 'change', listener: MediaChangeListener) => {
        listeners.delete(listener);
      }),
    };
    const environment: TestEnvironment = {
      matchMedia: () => media,
      root: { classList: { toggle }, style: { colorScheme: '' } },
      storage,
    };
    const model = createThemeModel();
    const cleanup = initialize(environment, model);

    for (const listener of listeners) {
      listener({ matches: true });
    }

    expect(model.resolved.value).toBe('dark');

    cleanup();
    const toggleCount = toggle.mock.calls.length;

    for (const listener of listeners) {
      listener({ matches: false });
    }

    const registeredListener = media.addEventListener.mock.calls[0]?.[1];
    expect(media.removeEventListener).toHaveBeenCalledWith('change', registeredListener);
    expect(listeners.size).toBe(0);
    expect(model.resolved.value).toBe('dark');
    expect(toggle).toHaveBeenCalledTimes(toggleCount);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
