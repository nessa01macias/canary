/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Publishable API key injected into the build; see src/lib/api.ts.
  readonly VITE_CANARY_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
