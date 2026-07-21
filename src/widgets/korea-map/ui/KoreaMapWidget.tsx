import { useMemo } from 'preact/hooks';
import { createKoreaMapSession, getNaverMapsGlLoader } from '../../../entities/map';
import { resolveNaverMapsConfig } from '../../../shared/config';
import { type KoreaMapServices, KoreaMapView } from './KoreaMapView';

const browserMapServices: KoreaMapServices = {
  createSession: (options) => createKoreaMapSession(options),
  loadMaps: (apiKeyId) => getNaverMapsGlLoader().load({ apiKeyId }),
  subscribeAuthenticationFailure: (listener) => getNaverMapsGlLoader().subscribeAuthenticationFailure(listener),
};

export function KoreaMapWidget() {
  const config = useMemo(
    () => resolveNaverMapsConfig(import.meta.env as unknown as Readonly<Record<string, unknown>>),
    [],
  );

  return <KoreaMapView config={config} services={browserMapServices} />;
}
