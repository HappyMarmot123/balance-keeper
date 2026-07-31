import { type CctvBounds, isSafeCctvHlsManifestUrl, isSafeCctvInitialHlsUrl } from '../../../entities/cctv/contract';
import { fetchItsCctvLiveMetadata } from './cctvList';
import { selectItsCctvMetadataById } from './cctvMetadata';

export type FetchItsCctvLiveMetadataByIdOptions = Readonly<{
  bounds: CctvBounds;
  cameraId: string;
  fetcher: typeof fetch;
  serviceKey: string;
  signal: AbortSignal;
}>;

export type ItsCctvLiveMetadata = Readonly<{
  cameraId: string;
  url: string;
}>;

export type ResolveItsCctvLiveManifestUrlOptions = Readonly<{
  fetcher: typeof fetch;
  initialUrl: string;
  signal: AbortSignal;
}>;

export class ItsCctvLiveManifestRedirectError extends Error {
  constructor() {
    super('CCTV live manifest redirect was rejected');
    this.name = 'ItsCctvLiveManifestRedirectError';
  }
}

export async function fetchItsCctvLiveMetadataById(
  options: FetchItsCctvLiveMetadataByIdOptions,
): Promise<ItsCctvLiveMetadata> {
  const metadata = await fetchItsCctvLiveMetadata(options);
  return selectItsCctvMetadataById(metadata, options.cameraId);
}

export async function resolveItsCctvLiveManifestUrl(options: ResolveItsCctvLiveManifestUrlOptions): Promise<string> {
  if (!isSafeCctvInitialHlsUrl(options.initialUrl)) {
    throw new ItsCctvLiveManifestRedirectError();
  }

  const response = await options.fetcher(options.initialUrl, {
    headers: { Accept: 'application/vnd.apple.mpegurl' },
    method: 'GET',
    redirect: 'manual',
    signal: options.signal,
  });
  const location = response.headers.get('location');
  try {
    await response.body?.cancel();
  } catch {
    throw new ItsCctvLiveManifestRedirectError();
  }
  if (response.status !== 302 || location === null) {
    throw new ItsCctvLiveManifestRedirectError();
  }

  let manifestUrl: string;
  try {
    manifestUrl = new URL(location, options.initialUrl).href;
  } catch {
    throw new ItsCctvLiveManifestRedirectError();
  }
  if (!isSafeCctvHlsManifestUrl(manifestUrl)) {
    throw new ItsCctvLiveManifestRedirectError();
  }
  return manifestUrl;
}
