const MAX_IF_NONE_MATCH_LENGTH = 8_192;

const parseEntityTagList = (value: string): string[] | undefined => {
  const tags: string[] = [];
  let offset = 0;

  while (offset < value.length) {
    while (value[offset] === ' ' || value[offset] === '\t') {
      offset += 1;
    }

    if (offset === value.length) {
      return tags;
    }

    if (value[offset] === ',') {
      offset += 1;
      continue;
    }

    if (value.startsWith('W/', offset)) {
      offset += 2;
    }

    if (value[offset] !== '"') {
      return undefined;
    }

    const start = offset;
    offset += 1;

    while (offset < value.length && value[offset] !== '"') {
      const codePoint = value.charCodeAt(offset);

      if (codePoint <= 0x20 || codePoint === 0x7f) {
        return undefined;
      }

      offset += 1;
    }

    if (value[offset] !== '"') {
      return undefined;
    }

    offset += 1;
    tags.push(value.slice(start, offset));

    while (value[offset] === ' ' || value[offset] === '\t') {
      offset += 1;
    }

    if (offset === value.length) {
      return tags;
    }

    if (value[offset] !== ',') {
      return undefined;
    }

    offset += 1;
  }

  return tags;
};

const parseEntityTag = (value: string): string | undefined => {
  const tags = parseEntityTagList(value);
  return tags?.length === 1 ? tags[0] : undefined;
};

export function matchesIfNoneMatch(headerValue: string | null, currentEtag: string): boolean {
  if (headerValue === null || headerValue.length > MAX_IF_NONE_MATCH_LENGTH) {
    return false;
  }

  const currentOpaqueTag = parseEntityTag(currentEtag);

  if (currentOpaqueTag === undefined) {
    return false;
  }

  if (headerValue.trim() === '*') {
    return true;
  }

  return parseEntityTagList(headerValue)?.includes(currentOpaqueTag) ?? false;
}
