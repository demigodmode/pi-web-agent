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
  provider: 'duckduckgo' | 'searxng' | 'brave' | 'youcom' | 'exa' | 'tavily' | 'google-serp';
  /** Endpoint of the selected provider. Under fanout, give the other endpoint-backed providers their own entry in baseUrls. */
  baseUrl?: string;
  /** Per-provider endpoints, so one endpoint-backed provider never has to reuse another's baseUrl (see resolveSearchBaseUrl). */
  baseUrls?: Partial<Record<SearchProviderName, string>>;
  /** Header the Google SERP key is sent in (default X-API-Key). */
  keyHeader?: string;
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
  allowRanges?: string[];
  /** Trust the upstream proxy to enforce private-address restrictions. */
  trustProxyDns?: boolean;
};

export type BackendConfig = {
  search: SearchBackendConfig;
  fetch: FetchBackendConfig;
  headless: HeadlessBackendConfig;
  proxy?: ProxyConfig;
  network?: NetworkConfig;
};

export const CLEARABLE_BACKEND_PATHS = [
  'search.baseUrl',
  'search.baseUrls',
  'search.baseUrls.searxng',
  'search.baseUrls.google-serp',
  'search.keyHeader',
  'search.fallback',
  'search.options',
  'search.options.categories',
  'search.options.language',
  'search.options.safesearch',
  'search.fanout',
  'search.fanout.providers',
  'fetch.baseUrl',
  'fetch.apiKey',
  'fetch.fallback',
  'fetch.options',
  'fetch.options.formats',
  'fetch.options.onlyMainContent',
  'proxy',
  'proxy.username',
  'proxy.password',
  'network',
  'network.allowRanges',
  'network.trustProxyDns',
] as const;

export type BackendClearPath = typeof CLEARABLE_BACKEND_PATHS[number];

export type BackendConfigOverride = {
  /** Optional values removed from lower-priority layers before applying this layer. */
  cleared?: BackendClearPath[];
  search?: Partial<SearchBackendConfig>;
  fetch?: Partial<FetchBackendConfig>;
  headless?: Partial<HeadlessBackendConfig>;
  proxy?: ProxyConfig;
  network?: NetworkConfig;
};

export type BackendConfigFile = {
  backends?: {
    cleared?: unknown;
    search?: { provider?: unknown; baseUrl?: unknown; baseUrls?: unknown; keyHeader?: unknown; fallback?: unknown; options?: unknown; fanout?: unknown };
    fetch?: { provider?: unknown; baseUrl?: unknown; apiKey?: unknown; fallback?: unknown; options?: unknown };
    headless?: { provider?: unknown };
    proxy?: { url?: unknown; username?: unknown; password?: unknown };
    network?: { allowRanges?: unknown; trustProxyDns?: unknown };
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
    // URL parsing failed; fail closed to avoid credential leaks
    return '(invalid URL)';
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
  const raw = value as { allowRanges?: unknown; trustProxyDns?: unknown };
  const config: NetworkConfig = {};
  if (Array.isArray(raw.allowRanges)) {
    // Coerce non-string entries so validation flags them instead of dropping the list.
    config.allowRanges = raw.allowRanges.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
  }
  if (typeof raw.trustProxyDns === 'boolean') config.trustProxyDns = raw.trustProxyDns;
  return Object.keys(config).length > 0 ? config : undefined;
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

const PROVIDER_NAMES: SearchProviderName[] = ['duckduckgo', 'searxng', 'brave', 'youcom', 'exa', 'tavily', 'google-serp'];

/** Providers that talk to an endpoint the user configures in backends.search.baseUrl. */
export const BASE_URL_SEARCH_PROVIDERS: readonly SearchProviderName[] = ['searxng', 'google-serp'];

/**
 * Whether `backends.search.baseUrl` is the key that configures this provider.
 *
 * The provider the user selected reads its endpoint from `baseUrl`. For anything else that is only
 * true for SearXNG under a selection that has no endpoint of its own: `baseUrl` predates this
 * provider, so a config that selects DuckDuckGo (or any hosted provider) and sets `baseUrl` still
 * means "the SearXNG endpoint", which is how a fanout set adds SearXNG to the default engine.
 * Validation names that key in its message, so it has to agree with resolveSearchBaseUrl.
 */
function searchBaseUrlApplies(search: SearchBackendConfig, provider: SearchProviderName): boolean {
  if (provider === search.provider) return true;
  return provider === 'searxng' && !BASE_URL_SEARCH_PROVIDERS.includes(search.provider);
}

/**
 * The endpoint one provider should talk to. `backends.search.baseUrls.<provider>` is that
 * provider's own endpoint and always wins; otherwise `baseUrl` is used, but only by the provider
 * it belongs to (see searchBaseUrlApplies).
 *
 * Without that split, a fanout set with both endpoint-backed providers would hand both of them the
 * same URL — and the Google key would ride along to SearXNG. A provider that has no endpoint of its
 * own is left out of the set instead (usableSearchProviders), never pointed at another's URL.
 */
export function resolveSearchBaseUrl(search: SearchBackendConfig, provider: SearchProviderName): string | undefined {
  // When the provider is the currently selected one, prefer the current baseUrl first,
  // then fall back to baseUrls[provider]. This ensures Settings edits take effect.
  if (provider === search.provider) {
    const current = search.baseUrl?.trim();
    if (current) return current;
    const own = search.baseUrls?.[provider]?.trim();
    if (own) return own;
    return searchBaseUrlApplies(search, provider) ? undefined : undefined;
  }
  // For non-selected providers, use their own baseUrls slot if set, otherwise apply legacy rules
  const own = search.baseUrls?.[provider]?.trim();
  if (own) return own;
  return searchBaseUrlApplies(search, provider) ? search.baseUrl?.trim() || undefined : undefined;
}

/** Providers a duckduckgo fallback can fall back from. */
export const DUCKDUCKGO_FALLBACK_PROVIDERS: readonly SearchProviderName[] = ['searxng', 'brave', 'youcom', 'exa', 'tavily', 'google-serp'];

export function usableSearchProviders(
  search: SearchBackendConfig,
  env: NodeJS.ProcessEnv = process.env
): SearchProviderName[] {
  // Match the provider implementations, which treat a blank/whitespace key as unconfigured.
  const usable: SearchProviderName[] = ['duckduckgo']; // keyless, always usable
  if (resolveSearchBaseUrl(search, 'searxng')) usable.push('searxng');
  if (env.PI_WEB_AGENT_BRAVE_API_KEY?.trim()) usable.push('brave');
  if (env.YDC_API_KEY?.trim()) usable.push('youcom');
  if (env.EXA_API_KEY?.trim()) usable.push('exa');
  if (env.TAVILY_API_KEY?.trim()) usable.push('tavily');
  if (resolveSearchBaseUrl(search, 'google-serp') && env.PI_WEB_AGENT_GOOGLE_SERP_API_KEY?.trim()) usable.push('google-serp');
  return usable;
}

/**
 * Per-provider endpoints. Only the endpoint-backed providers can have one, and the value has
 * to be a string: a typo drops the block rather than pointing a provider at an empty URL.
 */
function extractSearchBaseUrls(value: unknown): Partial<Record<SearchProviderName, string>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const baseUrls: Partial<Record<SearchProviderName, string>> = {};
  for (const [provider, url] of entries) {
    if (!BASE_URL_SEARCH_PROVIDERS.includes(provider as SearchProviderName)) return undefined;
    if (typeof url !== 'string') return undefined;
    baseUrls[provider as SearchProviderName] = url;
  }
  return baseUrls;
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

  if (typeof backends?.search?.provider === 'string' && (PROVIDER_NAMES as string[]).includes(backends.search.provider)) {
    override.search = { provider: backends.search.provider as SearchProviderName };
  }

  if (backends?.search?.fallback === 'duckduckgo') {
    override.search = { ...(override.search ?? {}), fallback: 'duckduckgo' };
  }
  if (backends?.search?.provider === undefined || backends.search.provider === 'searxng') {
    const options = extractSearxngOptions(backends?.search?.options);
    if (options) override.search = { ...(override.search ?? {}), options };
  }

  if (typeof backends?.search?.baseUrl === 'string') {
    override.search = { ...(override.search ?? {}), baseUrl: backends.search.baseUrl };
  }

  if (Array.isArray(backends?.cleared)) {
    const cleared = backends.cleared.filter(
      (value): value is BackendClearPath => typeof value === 'string' && (CLEARABLE_BACKEND_PATHS as readonly string[]).includes(value)
    );
    if (cleared.length > 0) override.cleared = [...new Set(cleared)];
  }

  const baseUrls = extractSearchBaseUrls(backends?.search?.baseUrls);
  if (baseUrls) {
    override.search = { ...(override.search ?? {}), baseUrls };
  }

  const keyHeader = typeof backends?.search?.keyHeader === 'string' ? backends.search.keyHeader : undefined;
  if (keyHeader) {
    override.search = { ...(override.search ?? {}), keyHeader };
  }

  const fanout = extractFanoutConfig(backends?.search?.fanout);
  if (fanout) {
    override.search = { ...(override.search ?? {}), fanout };
  }

  if (backends?.fetch?.provider === 'http' || backends?.fetch?.provider === 'firecrawl') {
    override.fetch = { provider: backends.fetch.provider };
  }
  if (typeof backends?.fetch?.baseUrl === 'string') {
    override.fetch = { ...(override.fetch ?? {}), baseUrl: backends.fetch.baseUrl };
  }
  if (typeof backends?.fetch?.apiKey === 'string') {
    override.fetch = { ...(override.fetch ?? {}), apiKey: backends.fetch.apiKey };
  }
  if (backends?.fetch?.fallback === 'http') {
    override.fetch = { ...(override.fetch ?? {}), fallback: 'http' };
  }
  const fetchOptions = extractFirecrawlOptions(backends?.fetch?.options);
  if (fetchOptions) override.fetch = { ...(override.fetch ?? {}), options: fetchOptions };

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

  if (BASE_URL_SEARCH_PROVIDERS.includes(config.search.provider) && !resolveSearchBaseUrl(config.search, config.search.provider)) {
    issues.push(`search provider ${config.search.provider} requires backends.search.baseUrl`);
  }

  for (const [provider, baseUrl] of Object.entries(config.search.baseUrls ?? {})) {
    if (baseUrl !== undefined && !baseUrl.trim()) {
      issues.push(`search baseUrls.${provider} must not be empty when provided`);
    }
  }

  if (config.search.keyHeader !== undefined && !config.search.keyHeader.trim()) {
    issues.push('search keyHeader must not be empty when provided');
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

  if (config.network?.trustProxyDns && !config.proxy?.url?.trim()) {
    issues.push('backends.network.trustProxyDns has no effect without backends.proxy');
  }

  if (config.search.fallback === 'duckduckgo' && !DUCKDUCKGO_FALLBACK_PROVIDERS.includes(config.search.provider)) {
    const supported = DUCKDUCKGO_FALLBACK_PROVIDERS.join(', ').replace(/, ([^,]*)$/, ', or $1');
    issues.push(`search fallback duckduckgo is only supported when search provider is ${supported}`);
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
    for (const provider of BASE_URL_SEARCH_PROVIDERS) {
      if (!fanout.providers?.includes(provider) || resolveSearchBaseUrl(config.search, provider)) continue;
      issues.push(
        searchBaseUrlApplies(config.search, provider)
          ? `search fanout with ${provider} requires backends.search.baseUrl`
          : `search fanout with ${provider} requires backends.search.baseUrls.${provider}`
      );
    }
  }

  return issues;
}

function mergeSearchConfig(
  current: SearchBackendConfig,
  override: Partial<SearchBackendConfig> | undefined
): SearchBackendConfig {
  if (!override) return current;
  // Per-provider endpoints are additive across layers: a project layer naming one endpoint
  // must not drop the endpoint a global layer set for the other provider.
  const baseUrls = { ...current.baseUrls, ...override.baseUrls };
  const withBaseUrls = Object.keys(baseUrls).length > 0 ? { baseUrls } : {};
  if (override.provider && override.provider !== current.provider) {
    const keyHeader = override.keyHeader ?? (current.keyHeader ? current.keyHeader : undefined);
    const withKeyHeader = keyHeader ? { keyHeader } : {};
    return { ...override, provider: override.provider, ...withBaseUrls, ...withKeyHeader };
  }
  return { ...current, ...override, ...withBaseUrls };
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

function mergeNetworkConfig(base: NetworkConfig | undefined, layer: NetworkConfig | undefined): NetworkConfig | undefined {
  if (!layer) return base;
  const next: NetworkConfig = { ...base };
  // A layer's allow list replaces the lower one outright; trust is set independently.
  if (layer.allowRanges) next.allowRanges = [...layer.allowRanges];
  if (layer.trustProxyDns !== undefined) next.trustProxyDns = layer.trustProxyDns;
  return next;
}

function clearBackendPaths(config: BackendConfig, paths: BackendClearPath[] | undefined): BackendConfig {
  if (!paths?.length) return config;
  const next = structuredClone(config);
  for (const path of paths) {
    if (!(CLEARABLE_BACKEND_PATHS as readonly string[]).includes(path)) continue;
    const parts = path.split('.');
    const key = parts.pop()!;
    let parent: Record<string, unknown> | undefined = next as unknown as Record<string, unknown>;
    for (const part of parts) {
      const value: unknown = parent?.[part];
      parent = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
    }
    if (parent) delete parent[key];
  }
  return next;
}

export function mergeBackendConfigLayers(
  ...layers: Array<BackendConfig | BackendConfigOverride | undefined>
): BackendConfig {
  return layers.reduce<BackendConfig>(
    (current, layer) => {
      const merged = clearBackendPaths(current, layer && 'cleared' in layer ? layer.cleared : undefined);
      return {
        search: mergeSearchConfig(merged.search, layer?.search),
        fetch: mergeFetchConfig(merged.fetch, layer?.fetch),
        headless: { ...merged.headless, ...layer?.headless },
        proxy: layer?.proxy
          ? layer.proxy.url === ''
            ? undefined // explicit disable overrides any proxy from lower layers
            : { ...merged.proxy, ...layer.proxy }
          : merged.proxy,
        // Replace, don't union: a project list is the whole list for that project.
        network: mergeNetworkConfig(merged.network, layer?.network)
      };
    },
    DEFAULT_BACKEND_CONFIG
  );
}
