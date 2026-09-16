import type { FanoutMode, SearchProviderName } from '../types.js';
import { parseCidr } from '../fetch/network-guard.js';

export type SearxngOptions = {
  categories?: string[];
  language?: string;
  safesearch?: 0 | 1 | 2;
};

export type FanoutConfig = {
  mode: FanoutMode;
  providers?: SearchProviderName[];
};

export type FirecrawlOptions = {
  formats?: string[];
  onlyMainContent?: boolean;
};

export type ProxyConfig = {
  url: string;
  username?: string;
  password?: string;
};

export type SearchBackendConfig = {
  provider: 'duckduckgo' | 'searxng' | 'brave' | 'youcom' | 'exa' | 'tavily';
  baseUrl?: string;
  fallback?: 'duckduckgo';
  options?: SearxngOptions;
  fanout?: FanoutConfig;
};

export type FetchBackendConfig = {
  provider: 'http' | 'firecrawl';
  baseUrl?: string;
  apiKey?: string;
  fallback?: 'http';
  options?: FirecrawlOptions;
};
export type HeadlessBackendConfig = { provider: 'local-browser' };

export type NetworkConfig = {
  /** CIDR ranges exempted from the private-address guard (#53). */
  allowRanges: string[];
};

export type BackendConfig = {
  search: SearchBackendConfig;
  fetch: FetchBackendConfig;
  headless: HeadlessBackendConfig;
  proxy?: ProxyConfig;
  network?: NetworkConfig;
};

export type BackendConfigOverride = {
  search?: Partial<SearchBackendConfig>;
  fetch?: Partial<FetchBackendConfig>;
  headless?: Partial<HeadlessBackendConfig>;
  proxy?: ProxyConfig;
  network?: NetworkConfig;
};

export type BackendConfigFile = {
  backends?: {
    search?: { provider?: unknown; baseUrl?: unknown; fallback?: unknown; options?: unknown; fanout?: unknown };
    fetch?: { provider?: unknown; baseUrl?: unknown; apiKey?: unknown; fallback?: unknown; options?: unknown };
    headless?: { provider?: unknown };
    proxy?: { url?: unknown; username?: unknown; password?: unknown };
    network?: { allowRanges?: unknown };
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

/**
 * Remove any credentials (user:pass@) embedded in a proxy URL. pi-web-agent
 * never reads or sends credentials from the URL; proxy auth comes from
 * backends.proxy.username/password or PI_WEB_AGENT_PROXY_USERNAME /
 * PI_WEB_AGENT_PROXY_PASSWORD. Stripping them here keeps them out of logs,
 * doctor output, the settings UI, and the proxy connection itself.
 */
export function stripProxyCredentials(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.username && !parsed.password) return url; // already credential-free
  parsed.username = '';
  parsed.password = '';
  return parsed.toString().replace(/\/$/, '');
}

/**
 * Whether a proxy url passes validation: a blank url is the "disable proxy"
 * marker and passes; anything else must parse as an http(s) URL. This is a
 * pure syntax check — no connectivity check is performed.
 */
export function isValidProxyUrl(url: string): boolean {
  if (url.trim() === '') return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function extractProxyConfig(value: unknown): ProxyConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { url?: unknown; username?: unknown; password?: unknown };

  // An explicitly present but blank url is the "disable proxy" marker: it lets a
  // higher-priority layer (e.g. a project) clear a proxy set in a lower layer.
  if (typeof raw.url === 'string' && raw.url.trim() === '') {
    return { url: '' };
  }

  if (typeof raw.url !== 'string' || !raw.url.trim()) return undefined;

  const url = raw.url.trim();
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  // A valid url is normalized. A malformed url is kept as-is (rather than
  // dropped) so validation can flag it and the backend factory can fail loudly
  // instead of silently sending traffic direct to the websites.
  const config: ProxyConfig = {
    url:
      parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        ? parsed.toString().replace(/\/$/, '')
        : url
  };
  if (typeof raw.username === 'string' && raw.username.trim()) config.username = raw.username;
  if (typeof raw.password === 'string') config.password = raw.password;
  return config;
}

export function extractNetworkConfig(value: unknown): NetworkConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as { allowRanges?: unknown }).allowRanges;
  if (!Array.isArray(raw)) return undefined;
  // Coerce non-string entries (e.g. a stray number) to strings instead of
  // dropping the whole list, so validateBackendConfig can flag them as
  // invalid CIDRs rather than silently disabling every entry the user typed.
  const allowRanges = raw.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
  return { allowRanges };
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

const PROVIDER_NAMES: SearchProviderName[] = ['duckduckgo', 'searxng', 'brave', 'youcom', 'exa', 'tavily'];

export function usableSearchProviders(
  search: SearchBackendConfig,
  env: NodeJS.ProcessEnv = process.env
): SearchProviderName[] {
  // Match the provider implementations, which treat a blank/whitespace key as unconfigured.
  const usable: SearchProviderName[] = ['duckduckgo']; // keyless, always usable
  if (search.baseUrl?.trim()) usable.push('searxng');
  if (env.PI_WEB_AGENT_BRAVE_API_KEY?.trim()) usable.push('brave');
  if (env.YDC_API_KEY?.trim()) usable.push('youcom');
  if (env.EXA_API_KEY?.trim()) usable.push('exa');
  if (env.TAVILY_API_KEY?.trim()) usable.push('tavily');
  return usable;
}

function extractFanoutConfig(value: unknown): FanoutConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { mode?: unknown; providers?: unknown };
  if (raw.mode !== 'off' && raw.mode !== 'on' && raw.mode !== 'auto') return undefined;
  const config: FanoutConfig = { mode: raw.mode };
  if (Array.isArray(raw.providers)) {
    const providers = raw.providers.filter(
      (p): p is SearchProviderName => typeof p === 'string' && (PROVIDER_NAMES as string[]).includes(p)
    );
    if (providers.length !== raw.providers.length) return undefined; // fail loud on any invalid entry
    if (providers.length > 0) config.providers = providers;
  }
  return config;
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

  const fanout = extractFanoutConfig(backends?.search?.fanout);
  if (fanout) {
    override.search = { ...(override.search ?? {}), fanout };
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

  const proxy = extractProxyConfig(backends?.proxy);
  if (proxy) {
    override.proxy = proxy;
  }

  const network = extractNetworkConfig(backends?.network);
  if (network) {
    override.network = network;
  }

  return override;
}

export function validateBackendConfig(config: BackendConfig): string[] {
  const issues: string[] = [];

  if (config.search.provider === 'searxng' && !config.search.baseUrl) {
    issues.push('search provider searxng requires backends.search.baseUrl');
  }

  if (config.proxy && config.proxy.url.trim() !== '') {
    let parsed: URL | undefined;
    try {
      parsed = new URL(config.proxy.url);
    } catch {
      parsed = undefined;
    }
    if (!isValidProxyUrl(config.proxy.url)) {
      issues.push('backends.proxy.url must be an http or https URL');
    } else if (parsed && (parsed.username || parsed.password)) {
      // Credentials belong in backends.proxy.username/password or the env vars
      // below, never in the URL itself.
      issues.push(
        'backends.proxy.url must not include credentials (user:pass@); set PI_WEB_AGENT_PROXY_USERNAME and PI_WEB_AGENT_PROXY_PASSWORD (or backends.proxy.username / backends.proxy.password) instead'
      );
    }
  }

  if (config.fetch.provider === 'firecrawl' && !config.fetch.baseUrl) {
    issues.push('fetch provider firecrawl requires backends.fetch.baseUrl');
  }

  for (const range of config.network?.allowRanges ?? []) {
    const cidr = parseCidr(range);
    if (!cidr) {
      issues.push(`backends.network.allowRanges entry "${range}" is not a valid CIDR range`);
    } else if (cidr.prefix === 0) {
      issues.push(
        `backends.network.allowRanges entry "${range}" allows every address, which turns the guard off; list specific ranges instead`
      );
    }
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

  const fanout = config.search.fanout;
  if (fanout) {
    if (fanout.mode !== 'off' && fanout.mode !== 'on' && fanout.mode !== 'auto') {
      issues.push('search fanout.mode must be off, on, or auto');
    }
    if (fanout.providers?.includes('searxng') && !config.search.baseUrl) {
      issues.push('search fanout with searxng requires backends.search.baseUrl');
    }
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
      headless: { ...merged.headless, ...layer?.headless },
      proxy: layer?.proxy
        ? layer.proxy.url === ''
          ? undefined // explicit disable overrides any proxy from lower layers
          : { ...merged.proxy, ...layer.proxy }
        : merged.proxy,
      // Replace, don't union: a project list is the whole list for that project.
      network: layer?.network ? { allowRanges: [...layer.network.allowRanges] } : merged.network
    }),
    DEFAULT_BACKEND_CONFIG
  );
}
