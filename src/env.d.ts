/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SITE_URL?: string;
  readonly SITE_STAGE?: "preview" | "release";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
