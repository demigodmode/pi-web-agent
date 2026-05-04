export type SearchBackendConfig = { provider: 'duckduckgo' };
export type FetchBackendConfig = { provider: 'http' };
export type HeadlessBackendConfig = { provider: 'local-browser' };

export type BackendConfig = {
  search: SearchBackendConfig;
  fetch: FetchBackendConfig;
  headless: HeadlessBackendConfig;
};

export type BackendConfigOverride = {
  search?: Partial<SearchBackendConfig>;
  fetch?: Partial<FetchBackendConfig>;
  headless?: Partial<HeadlessBackendConfig>;
};

export type BackendConfigFile = {
  backends?: {
    search?: { provider?: unknown };
    fetch?: { provider?: unknown };
    headless?: { provider?: unknown };
  };
};

export const DEFAULT_BACKEND_CONFIG: BackendConfig = {
  search: { provider: 'duckduckgo' },
  fetch: { provider: 'http' },
  headless: { provider: 'local-browser' }
};

export function extractBackendConfigOverride(
  file: BackendConfigFile | null | undefined
): BackendConfigOverride {
  const backends = file?.backends;
  const override: BackendConfigOverride = {};

  if (backends?.search?.provider === 'duckduckgo') {
    override.search = { provider: 'duckduckgo' };
  }

  if (backends?.fetch?.provider === 'http') {
    override.fetch = { provider: 'http' };
  }

  if (backends?.headless?.provider === 'local-browser') {
    override.headless = { provider: 'local-browser' };
  }

  return override;
}

export function mergeBackendConfigLayers(
  ...layers: Array<BackendConfig | BackendConfigOverride | undefined>
): BackendConfig {
  return layers.reduce<BackendConfig>(
    (merged, layer) => ({
      search: { ...merged.search, ...layer?.search },
      fetch: { ...merged.fetch, ...layer?.fetch },
      headless: { ...merged.headless, ...layer?.headless }
    }),
    DEFAULT_BACKEND_CONFIG
  );
}
