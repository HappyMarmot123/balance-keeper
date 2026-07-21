import { useId } from 'preact/hooks';
import type { ThemeModel, ThemePreference } from '../../../shared/model';
import { themeModel } from '../../../shared/model';

type ThemeSwitchProps = {
  model?: ThemeModel;
};

const themeOptions: ReadonlyArray<{ label: string; value: ThemePreference }> = [
  { label: '시스템', value: 'system' },
  { label: '라이트', value: 'light' },
  { label: '다크', value: 'dark' },
];

export function ThemeSwitch({ model = themeModel }: ThemeSwitchProps) {
  const groupName = useId();

  return (
    <fieldset className="rounded-sm border border-boundary bg-surface px-1 pb-1">
      <legend className="px-1 font-data text-xs font-semibold tracking-wide text-muted">화면 테마</legend>
      <div className="flex flex-wrap gap-1">
        {themeOptions.map((option) => (
          <label className="cursor-pointer" key={option.value}>
            <input
              checked={model.preference.value === option.value}
              className="peer sr-only"
              name={groupName}
              onChange={() => model.setPreference(option.value)}
              type="radio"
              value={option.value}
            />
            <span className="block rounded-sm px-2 py-1 font-data text-xs text-muted peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-on-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
              <span aria-hidden="true" className="mr-1 inline-block w-3 text-center">
                {model.preference.value === option.value ? '✓' : ''}
              </span>
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
