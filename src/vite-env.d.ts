/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NAVER_MAPS_KEY_ID?: string;
  readonly VITE_NAVER_MAP_STYLE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
