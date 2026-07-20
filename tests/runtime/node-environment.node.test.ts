import { describe, expect, it } from 'vitest';

describe('Node test project', () => {
  it('does not expose a browser document', () => {
    expect(typeof document).toBe('undefined');
  });
});
