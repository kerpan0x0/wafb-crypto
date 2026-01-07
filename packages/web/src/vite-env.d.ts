interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_ENABLE_DEBUG_LOGS: string;
  readonly VITE_ENABLE_MOCK_DEVICE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}