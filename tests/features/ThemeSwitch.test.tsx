import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';

import { ThemeSwitch } from '../../src/features/theme-switch';
import { createThemeModel } from '../../src/shared/model';

describe('ThemeSwitch', () => {
  it('presents the three preferences as a labelled native radio group', () => {
    const model = createThemeModel();

    render(<ThemeSwitch model={model} />);

    expect(screen.getByRole('group', { name: '화면 테마' })).toBeTruthy();

    const system = screen.getByRole('radio', { name: '시스템' }) as HTMLInputElement;
    const light = screen.getByRole('radio', { name: '라이트' }) as HTMLInputElement;
    const dark = screen.getByRole('radio', { name: '다크' }) as HTMLInputElement;

    expect(system.checked).toBe(true);
    expect(light.checked).toBe(false);
    expect(dark.checked).toBe(false);
  });

  it('updates the shared preference through native radio interaction', () => {
    const model = createThemeModel('light');

    render(<ThemeSwitch model={model} />);

    const light = screen.getByRole('radio', { name: '라이트' }) as HTMLInputElement;
    const dark = screen.getByRole('radio', { name: '다크' }) as HTMLInputElement;

    expect(light.checked).toBe(true);

    fireEvent.click(dark);

    expect(model.preference.value).toBe('dark');
    expect(dark.checked).toBe(true);
    expect(light.checked).toBe(false);
  });

  it('shows a non-color check mark for the selected preference', () => {
    const model = createThemeModel('light');

    render(<ThemeSwitch model={model} />);

    const light = screen.getByRole('radio', { name: '라이트' });
    const dark = screen.getByRole('radio', { name: '다크' });

    expect(light.nextElementSibling?.textContent).toContain('✓');
    expect(dark.nextElementSibling?.textContent).not.toContain('✓');

    fireEvent.click(dark);

    expect(light.nextElementSibling?.textContent).not.toContain('✓');
    expect(dark.nextElementSibling?.textContent).toContain('✓');
  });
});
