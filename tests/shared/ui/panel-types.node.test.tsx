// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { PanelProps } from '../../../src/shared/ui';

const validSuccess: PanelProps = {
  children: '관측값',
  freshness: { dateTime: '2026-07-20', label: '2026-07-20 기준' },
  status: 'success',
  title: '정상',
};

// @ts-expect-error success requires upstream freshness
const successWithoutFreshness: PanelProps = { children: '관측값', status: 'success', title: '오류' };

// @ts-expect-error loading cannot receive an error-only retry callback
const loadingWithRetry: PanelProps = { onRetry: () => undefined, status: 'loading', title: '오류' };

// @ts-expect-error stale requires retained content
const staleWithoutContent: PanelProps = {
  freshness: { dateTime: '2026-07-20', label: '2026-07-20 기준' },
  message: '이전 자료',
  status: 'stale',
  title: '오류',
};

const credentialWithMessage: PanelProps = {
  // @ts-expect-error missing-credential uses fixed safe copy and rejects caller-provided messages
  message: 'SECRET=value',
  status: 'missing-credential',
  title: '오류',
};

describe('Panel type contract', () => {
  it('keeps valid success props constructible', () => {
    expect(validSuccess.status).toBe('success');
    expect(successWithoutFreshness.status).toBe('success');
    expect(loadingWithRetry.status).toBe('loading');
    expect(staleWithoutContent.status).toBe('stale');
    expect(credentialWithMessage.status).toBe('missing-credential');
  });
});
