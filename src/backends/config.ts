export type SearchBackendConfig = { provider: 'duckduckgo' | 'searxng'; baseUrl?: string };
export type FetchBackendConfig = { provider: 'http' | 'firecrawl'; baseUrl?: string; apiKey?: string };
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
    search?: { provider?: unknown; baseUrl?: unknown };
    fetch?: { provider?: unknown; baseUrl?: unknown; apiKey?: unknown };
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

  if (backends?.search?.provider === 'duckduckgo' || backends?.search?.provider === 'searxng') {
    override.search = { provider: backends.search.provider };
    if (typeof backends.search.baseUrl === 'string') {
      override.search.baseUrl = backends.search.baseUrl;
    }
  }

  if (backends?.fetch?.provider === 'http' || backends?.fetch?.provider === 'firecrawl') {
    override.fetch = { provider: backends.fetch.provider };
    if (typeof backends.fetch.baseUrl === 'string') {
      override.fetch.baseUrl = backends.fetch.baseUrl;
    }
    if (typeof backends.fetch.apiKey === 'string') {
      override.fetch.apiKey = backends.fetch.apiKey;
    }
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
