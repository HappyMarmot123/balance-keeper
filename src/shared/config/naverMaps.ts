export type NaverMapsConfig =
  | Readonly<{ kind: 'missing-key' }>
  | Readonly<{ kind: 'ready'; apiKeyId: string; styleId?: string }>;

type BrowserEnvironment = Readonly<Record<string, unknown>>;

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveNaverMapsConfig(environment: BrowserEnvironment): NaverMapsConfig {
  const apiKeyId = readTrimmedString(environment.VITE_NAVER_MAPS_KEY_ID);

  if (!apiKeyId) {
    return { kind: 'missing-key' };
  }

  const styleId = readTrimmedString(environment.VITE_NAVER_MAP_STYLE_ID);
  return styleId ? { kind: 'ready', apiKeyId, styleId } : { kind: 'ready', apiKeyId };
}
