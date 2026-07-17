export type SearxngOptions = {
  categories?: string[];
  language?: string;
  safesearch?: 0 | 1 | 2;
};

export type FirecrawlOptions = {
  formats?: string[];
  onlyMainContent?: boolean;
};

export type SearchBackendConfig = {
  provider: 'duckduckgo' | 'searxng' | 'brave' | 'youcom' | 'exa' | 'tavily';
  baseUrl?: string;
  fallback?: 'duckduckgo';
  options?: SearxngOptions;
};

export type FetchBackendConfig = {
  provider: 'http' | 'firecrawl';
  baseUrl?: string;
  apiKey?: string;
  fallback?: 'http';
  options?: FirecrawlOptions;
};
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
    search?: { provider?: unknown; baseUrl?: unknown; fallback?: unknown; options?: unknown };
    fetch?: { provider?: unknown; baseUrl?: unknown; apiKey?: unknown; fallback?: unknown; options?: unknown };
    headless?: { provider?: unknown };
  };
};

export const DEFAULT_BACKEND_CONFIG: BackendConfig = {
  search: { provider: 'duckduckgo' },
  fetch: { provider: 'http' },
  headless: { provider: 'local-browser' }
};

function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length === value.length ? strings : undefined;
}

function extractSearxngOptions(value: unknown): SearxngOptions | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { categories?: unknown; language?: unknown; safesearch?: unknown };
  const options: SearxngOptions = {};
  const categories = extractStringArray(raw.categories);
  if (categories) options.categories = categories;
  if (typeof raw.language === 'string') options.language = raw.language;
  if (raw.safesearch === 0 || raw.safesearch === 1 || raw.safesearch === 2) options.safesearch = raw.safesearch;
  return Object.keys(options).length > 0 ? options : undefined;
}

function extractFirecrawlOptions(value: unknown): FirecrawlOptions | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { formats?: unknown; onlyMainContent?: unknown };
  const options: FirecrawlOptions = {};
  const formats = extractStringArray(raw.formats);
  if (formats) options.formats = formats;
  if (typeof raw.onlyMainContent === 'boolean') options.onlyMainContent = raw.onlyMainContent;
  return Object.keys(options).length > 0 ? options : undefined;
}

export function extractBackendConfigOverride(
  file: BackendConfigFile | null | undefined
): BackendConfigOverride {
  const backends = file?.backends;
  const override: BackendConfigOverride = {};

  if (
    backends?.search?.provider === 'duckduckgo' ||
    backends?.search?.provider === 'searxng' ||
    backends?.search?.provider === 'brave' ||
    backends?.search?.provider === 'youcom' ||
    backends?.search?.provider === 'exa' ||
    backends?.search?.provider === 'tavily'
  ) {
    override.search = { provider: backends.search.provider };
    if (backends.search.provider === 'searxng' && typeof backends.search.baseUrl === 'string') {
      override.search.baseUrl = backends.search.baseUrl;
    }
    if (backends.search.fallback === 'duckduckgo') {
      override.search.fallback = 'duckduckgo';
    }
    if (backends.search.provider === 'searxng') {
      const options = extractSearxngOptions(backends.search.options);
      if (options) {
        override.search.options = options;
      }
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
    if (backends.fetch.fallback === 'http') {
      override.fetch.fallback = 'http';
    }
    const options = extractFirecrawlOptions(backends.fetch.options);
    if (options) {
      override.fetch.options = options;
    }
  }

  if (backends?.headless?.provider === 'local-browser') {
    override.headless = { provider: 'local-browser' };
  }

  return override;
}

export function validateBackendConfig(config: BackendConfig): string[] {
  const issues: string[] = [];

  if (config.search.provider === 'searxng' && !config.search.baseUrl) {
    issues.push('search provider searxng requires backends.search.baseUrl');
  }

  if (config.fetch.provider === 'firecrawl' && !config.fetch.baseUrl) {
    issues.push('fetch provider firecrawl requires backends.fetch.baseUrl');
  }

  if (config.search.fallback === 'duckduckgo' && config.search.provider !== 'searxng' && config.search.provider !== 'brave' && config.search.provider !== 'youcom' && config.search.provider !== 'exa' && config.search.provider !== 'tavily') {
    issues.push('search fallback duckduckgo is only supported when search provider is searxng, brave, youcom, exa, or tavily');
  }

  if (config.fetch.fallback === 'http' && config.fetch.provider !== 'firecrawl') {
    issues.push('fetch fallback http is only supported when fetch provider is firecrawl');
  }

  if (config.search.options?.categories && config.search.options.categories.length === 0) {
    issues.push('search options.categories must contain at least one category when provided');
  }

  if (config.search.options?.language !== undefined && !config.search.options.language.trim()) {
    issues.push('search options.language must not be empty when provided');
  }

  if (
    config.search.options?.safesearch !== undefined &&
    ![0, 1, 2].includes(config.search.options.safesearch)
  ) {
    issues.push('search options.safesearch must be 0, 1, or 2 when provided');
  }

  if (config.fetch.options?.formats && config.fetch.options.formats.length === 0) {
    issues.push('fetch options.formats must contain at least one format when provided');
  }

  return issues;
}

function mergeSearchConfig(
  current: SearchBackendConfig,
  override: Partial<SearchBackendConfig> | undefined
): SearchBackendConfig {
  if (!override) return current;
  if (override.provider && override.provider !== current.provider) {
    return { ...override, provider: override.provider };
  }
  return { ...current, ...override };
}

function mergeFetchConfig(
  current: FetchBackendConfig,
  override: Partial<FetchBackendConfig> | undefined
): FetchBackendConfig {
  if (!override) return current;
  if (override.provider && override.provider !== current.provider) {
    return { ...override, provider: override.provider };
  }
  return { ...current, ...override };
}

export function mergeBackendConfigLayers(
  ...layers: Array<BackendConfig | BackendConfigOverride | undefined>
): BackendConfig {
  return layers.reduce<BackendConfig>(
    (merged, layer) => ({
      search: mergeSearchConfig(merged.search, layer?.search),
      fetch: mergeFetchConfig(merged.fetch, layer?.fetch),
      headless: { ...merged.headless, ...layer?.headless }
    }),
    DEFAULT_BACKEND_CONFIG
  );
}
