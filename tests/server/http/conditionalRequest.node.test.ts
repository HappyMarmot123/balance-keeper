// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { matchesIfNoneMatch } from '../../../src/server/http';

describe('matchesIfNoneMatch', () => {
  it('uses weak comparison for the current entity tag', () => {
    const current = 'W/"bk1-current"';

    expect(matchesIfNoneMatch('W/"bk1-current"', current)).toBe(true);
    expect(matchesIfNoneMatch('"bk1-current"', current)).toBe(true);
    expect(matchesIfNoneMatch('W/"bk1-other"', current)).toBe(false);
  });

  it('matches wildcard and comma-separated entity-tag lists without splitting quoted commas', () => {
    const current = 'W/"bk1-current"';

    expect(matchesIfNoneMatch('*', current)).toBe(true);
    expect(matchesIfNoneMatch('"other", W/"bk1-current", "last"', current)).toBe(true);
    expect(matchesIfNoneMatch('"other,still-other", "last"', current)).toBe(false);
  });

  it('ignores empty list elements allowed by the HTTP list grammar', () => {
    const current = 'W/"bk1-current"';

    expect(matchesIfNoneMatch(', W/"bk1-current"', current)).toBe(true);
    expect(matchesIfNoneMatch('W/"bk1-current",', current)).toBe(true);
    expect(matchesIfNoneMatch('"other", , W/"bk1-current", ,', current)).toBe(true);
  });

  it('ignores malformed and oversized conditional headers', () => {
    const current = 'W/"bk1-current"';
    const oversized = `${'"other",'.repeat(1_200)} ${current}`;

    expect(matchesIfNoneMatch(null, current)).toBe(false);
    expect(matchesIfNoneMatch('"unterminated', current)).toBe(false);
    expect(matchesIfNoneMatch('"other",', current)).toBe(false);
    expect(matchesIfNoneMatch(oversized, current)).toBe(false);
  });
});
