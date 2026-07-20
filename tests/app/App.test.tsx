import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';

import { App } from '../../src/app/App';

describe('application bootstrap', () => {
  it('renders the Korea Monitor foundation status', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Korea Monitor' })).toBeTruthy();
    expect(screen.getByText('프로젝트 기반 설정이 완료되었습니다.')).toBeTruthy();
  });
});
