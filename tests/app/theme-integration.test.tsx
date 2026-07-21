import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { initializeTheme } from '../../src/app/theme/initializeTheme';
import { ThemeSwitch } from '../../src/features/theme-switch';
import { themeModel } from '../../src/shared/model';

describe('application theme integration', () => {
  it('connects the default ThemeSwitch model to root styling and persistence', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const media = {
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    };
    const root = document.documentElement;

    themeModel.setPreference('system');
    themeModel.setSystemTheme('light');

    const disposeTheme = initializeTheme({ matchMedia: () => media, root, storage });

    try {
      render(<ThemeSwitch />);
      fireEvent.click(screen.getByRole('radio', { name: '다크' }));

      expect(themeModel.preference.value).toBe('dark');
      expect(root.classList.contains('dark')).toBe(true);
      expect(root.style.colorScheme).toBe('dark');
      expect(storage.setItem).toHaveBeenLastCalledWith('balance-keeper:theme', 'dark');
    } finally {
      disposeTheme();
      themeModel.setPreference('system');
      themeModel.setSystemTheme('light');
      root.classList.remove('dark');
      root.style.colorScheme = '';
    }
  });
});
