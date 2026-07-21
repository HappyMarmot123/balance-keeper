const isPlainObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const unsupportedValue = (): never => {
  throw new TypeError('Cache identities and validators accept JSON values only');
};

const serializeCanonical = (value: unknown, ancestors: WeakSet<object>): string => {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : unsupportedValue();
    case 'object':
      break;
    default:
      return unsupportedValue();
  }

  if (ancestors.has(value)) {
    return unsupportedValue();
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const items: string[] = [];

      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return unsupportedValue();
        }

        items.push(serializeCanonical(value[index], ancestors));
      }

      return `[${items.join(',')}]`;
    }

    if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
      return unsupportedValue();
    }

    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeCanonical(value[key], ancestors)}`);

    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
};

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, new WeakSet());
}
