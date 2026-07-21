// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/server/cache';

describe('canonicalJson', () => {
  it('sorts plain-object keys recursively while preserving array order', () => {
    expect(
      canonicalJson({
        zebra: 1,
        alpha: { second: true, first: null },
        list: [{ z: 'last', a: 'first' }, 2, false],
      }),
    ).toBe('{"alpha":{"first":null,"second":true},"list":[{"a":"first","z":"last"},2,false],"zebra":1}');
  });

  it.each([
    ['undefined', undefined],
    ['function', () => undefined],
    ['symbol', Symbol('private')],
    ['bigint', 1n],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['a Date', new Date(0)],
  ])('rejects non-JSON value %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('rejects a non-JSON value nested in an object instead of omitting it', () => {
    expect(() => canonicalJson({ safe: true, omittedByJsonStringify: undefined })).toThrow(TypeError);
  });

  it('rejects sparse arrays instead of converting holes to null', () => {
    const sparse = new Array<unknown>(2);
    sparse[1] = 'value';

    expect(() => canonicalJson(sparse)).toThrow(TypeError);
  });

  it('rejects cycles but permits a repeated acyclic reference', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalJson(cyclic)).toThrow(TypeError);

    const shared = { value: 1 };
    expect(canonicalJson({ left: shared, right: shared })).toBe('{"left":{"value":1},"right":{"value":1}}');
  });

  it('accepts a null-prototype plain object', () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.z = 2;
    value.a = 1;

    expect(canonicalJson(value)).toBe('{"a":1,"z":2}');
  });
});
