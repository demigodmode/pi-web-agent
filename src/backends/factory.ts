import { createFirecrawlFetcher } from '../fetch/firecrawl-fetch.js';
import { createHttpFetcher } from '../fetch/http-fetch.js';
import { createProxyFetch, resolveProxyCredentials } from '../fetch/proxy-fetch.js';
import { headlessFetch } from '../fetch/headless-fetch.js';
import { createBraveSearchTool } from '../search/brave.js';
import { createYouComSearchTool } from '../search/youcom.js';
import { fetchDuckDuckGoHtml } from '../search/duckduckgo.js';
import { createExaSearchTool } from '../search/exa.js';
import { createTavilySearchTool } from '../search/tavily.js';
import { createSearxngSearchTool } from '../search/searxng.js';
import { createFanoutSearch } from '../search/fanout.js';
import { buildFetchPresentation } from '../presentation/fetch-presentation.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { createWebFetchHeadlessTool } from '../tools/web-fetch-headless.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createWebSearchTool } from '../tools/web-search.js';
import type { SearchProviderName, WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
import { DEFAULT_BACKEND_CONFIG, type BackendConfig, type ProxyConfig, usableSearchProviders } from './config.js';
import { createSpecialContentResolver } from '../readers/resolver.js';
import { createGithubReader } from '../readers/github-reader.js';
import { createPdfReader } from '../readers/pdf-reader.js';
import { createYoutubeReader } from '../readers/youtube-reader.js';

export type BackendSet = {
  search: (input: { query: string }) => Promise<WebSearchResponse>;
  fetchPage: (input: { url: string }) => Promise<WebFetchResponse>;
  headlessFetch: (input: { url: string }) => Promise<WebFetchHeadlessResponse>;
};

export type BackendFactoryDeps = {
  createDuckDuckGoSearch?: typeof createWebSearchTool;
  createSearxngSearch?: typeof createSearxngSearchTool;
  createBraveSearch?: typeof createBraveSearchTool;
  createYouComSearch?: typeof createYouComSearchTool;
  createExaSearch?: typeof createExaSearchTool;
  createTavilySearch?: typeof createTavilySearchTool;
  createHttpFetch?: typeof createWebFetchTool;
  createFirecrawlFetch?: typeof createFirecrawlFetcher;
  createHeadlessFetch?: typeof createWebFetchHeadlessTool;
  createProxyFetch?: (proxy: ProxyConfig) => typeof fetch;
};

function invalidSearxngSearch() {
  return async function search() {
    const result: WebSearchResponse = {
      status: 'error',
      results: [],
      metadata: { backend: 'searxng', cacheHit: false },
      error: {
        code: 'BACKEND_CONFIG_INVALID',
        message: 'SearXNG search requires backends.search.baseUrl.'
      }
    };

    return { ...result, presentation: buildSearchPresentation(result) };
  };
}

function invalidFirecrawlFetch() {
  return async function fetchPage(url: string): Promise<WebFetchResponse> {
    const result: WebFetchResponse = {
      status: 'error',
      url,
      metadata: { method: 'firecrawl', cacheHit: false },
      error: {
        code: 'BACKEND_CONFIG_INVALID',
        message: 'Firecrawl fetch requires backends.fetch.baseUrl.'
      }
    };

    return { ...result, presentation: buildFetchPresentation(result) };
  };
}

function withSearchFallback(
  primary: BackendSet['search'],
  fallback: BackendSet['search'],
  fallbackFrom: 'searxng' | 'brave' | 'youcom' | 'exa' | 'tavily' | 'duckduckgo'
): BackendSet['search'] {
  return async (input) => {
    const first = await primary(input);
    if (first.status !== 'error') return first;

    const second = await fallback(input);
    const result: WebSearchResponse = {
      ...second,
      metadata: {
        ...second.metadata,
        fallbackFrom,
        fallbackReason: first.error?.message ?? `${fallbackFrom} search failed.`,
        // Keep the primary's fanout provenance (which providers were tried/skipped) even though
        // the answer came from the fallback backend.
        ...(first.metadata.fanout ? { fanout: first.metadata.fanout } : {})
      }
    };
    return { ...result, presentation: buildSearchPresentation(result) };
  };
}

function withFetchFallback(
  primary: BackendSet['fetchPage'],
  fallback: BackendSet['fetchPage']
): BackendSet['fetchPage'] {
  return async (input) => {
    const first = await primary(input);
    if (first.status !== 'error' && first.status !== 'needs_headless') return first;

    const second = await fallback(input);
    const result: WebFetchResponse = {
      ...second,
      metadata: {
        ...second.metadata,
        fallbackFrom: 'firecrawl',
        fallbackReason: first.error?.message ?? 'Firecrawl fetch failed.'
      }
    };
    return { ...result, presentation: buildFetchPresentation(result) };
  };
}

export function createBackendSet(
  config: BackendConfig = DEFAULT_BACKEND_CONFIG,
  deps: BackendFactoryDeps = {}
): BackendSet {
  const createDuckDuckGoSearch = deps.createDuckDuckGoSearch ?? createWebSearchTool;
  const createSearxngSearch = deps.createSearxngSearch ?? createSearxngSearchTool;
  const createBraveSearch = deps.createBraveSearch ?? createBraveSearchTool;
  const createYouComSearch = deps.createYouComSearch ?? createYouComSearchTool;
  const createExaSearch = deps.createExaSearch ?? createExaSearchTool;
  const createTavilySearch = deps.createTavilySearch ?? createTavilySearchTool;
  const createHttpFetch = deps.createHttpFetch ?? createWebFetchTool;
  const createFirecrawlFetch = deps.createFirecrawlFetch ?? createFirecrawlFetcher;
  const createHeadlessFetch = deps.createHeadlessFetch ?? createWebFetchHeadlessTool;
  const makeProxyFetch = deps.createProxyFetch ?? createProxyFetch;

  // When a proxy is configured, every outbound HTTP request (search, fetch,
  // readers, and doctor-style checks) goes through it; headless browser
  // traffic gets the same proxy via Playwright launch options.
  const fetchImpl: typeof fetch = config.proxy ? makeProxyFetch(config.proxy) : fetch;
  const proxyCredentials = config.proxy ? resolveProxyCredentials(config.proxy) : undefined;
  const proxyBrowserOptions = config.proxy
    ? {
        server: config.proxy.url,
        ...(proxyCredentials?.username !== undefined ? { username: proxyCredentials.username } : {}),
        ...(proxyCredentials?.password !== undefined ? { password: proxyCredentials.password } : {})
      }
    : undefined;

  const createDuckDuckGo = () =>
    createDuckDuckGoSearch({ searchHtml: (query) => fetchDuckDuckGoHtml(query, { fetchImpl }) });

  function buildProviderSearch(name: SearchProviderName): BackendSet['search'] {
    switch (name) {
      case 'searxng':
        return config.search.baseUrl
          ? createSearxngSearch({ baseUrl: config.search.baseUrl, options: config.search.options, fetchImpl })
          : invalidSearxngSearch();
      case 'brave':
        return createBraveSearch({ apiKey: process.env.PI_WEB_AGENT_BRAVE_API_KEY, fetchImpl });
      case 'youcom':
        return createYouComSearch({ apiKey: process.env.YDC_API_KEY, fetchImpl });
      case 'exa':
        return createExaSearch({ apiKey: process.env.EXA_API_KEY, fetchImpl });
      case 'tavily':
        return createTavilySearch({ apiKey: process.env.TAVILY_API_KEY, fetchImpl });
      case 'duckduckgo':
      default:
        return createDuckDuckGo();
    }
  }

  let search = config.search.provider === 'searxng'
    ? config.search.baseUrl
      ? createSearxngSearch({ baseUrl: config.search.baseUrl, options: config.search.options, fetchImpl })
      : invalidSearxngSearch()
    : config.search.provider === 'brave'
      ? createBraveSearch({ apiKey: process.env.PI_WEB_AGENT_BRAVE_API_KEY, fetchImpl })
      : config.search.provider === 'youcom'
        ? createYouComSearch({ apiKey: process.env.YDC_API_KEY, fetchImpl })
        : config.search.provider === 'exa'
          ? createExaSearch({ apiKey: process.env.EXA_API_KEY, fetchImpl })
          : config.search.provider === 'tavily'
            ? createTavilySearch({ apiKey: process.env.TAVILY_API_KEY, fetchImpl })
            : createDuckDuckGo();

  if (config.search.provider === 'searxng' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGo(), 'searxng');
  }

  if (config.search.provider === 'brave' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGo(), 'brave');
  }

  if (config.search.provider === 'youcom' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGo(), 'youcom');
  }

  if (config.search.provider === 'exa' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGo(), 'exa');
  }

  if (config.search.provider === 'tavily' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGo(), 'tavily');
  }

  const fanoutConfig = config.search.fanout;
  if (fanoutConfig && fanoutConfig.mode !== 'off') {
    const baseNames =
      fanoutConfig.providers && fanoutConfig.providers.length > 0
        ? fanoutConfig.providers
        : usableSearchProviders(config.search);
    // A configured DuckDuckGo fallback must still be honored under fanout: fold it into the set.
    const providerNames =
      config.search.fallback === 'duckduckgo' && !baseNames.includes('duckduckgo')
        ? [...baseNames, 'duckduckgo' as SearchProviderName]
        : baseNames;
    const ordered = [config.search.provider, ...providerNames.filter((n) => n !== config.search.provider)].filter(
      (n, i, arr) => arr.indexOf(n) === i
    );
    search = createFanoutSearch({
      providers: ordered.map((name) => ({ name, search: buildProviderSearch(name) })),
      mode: fanoutConfig.mode
    });
  }

  // Keep the keyless Tavily safety net for the no-key DuckDuckGo default, even under fanout —
  // it wraps whatever search ended up being (plain DDG or the fanout set) so a total failure
  // still has somewhere to go. Opt out with PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK=1.
  const keylessFallbackDisabled = process.env.PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK === '1';
  const usingDuckDuckGoDefault =
    config.search.provider === 'duckduckgo' || !config.search.provider;
  if (usingDuckDuckGoDefault && !keylessFallbackDisabled) {
    search = withSearchFallback(search, createTavilySearch({ keyless: true, fetchImpl }), 'duckduckgo');
  }

  const httpFetch = createHttpFetch({ fetchPage: createHttpFetcher({ fetchImpl }) });
  let fetchPage = config.fetch.provider === 'firecrawl'
    ? config.fetch.baseUrl
      ? createHttpFetch({
          fetchPage: createFirecrawlFetch({
            baseUrl: config.fetch.baseUrl,
            apiKey: config.fetch.apiKey ?? process.env.PI_WEB_AGENT_FIRECRAWL_API_KEY,
            options: config.fetch.options,
            fetchImpl
          })
        })
      : createHttpFetch({ fetchPage: invalidFirecrawlFetch() })
    : httpFetch;

  if (config.fetch.provider === 'firecrawl' && config.fetch.fallback === 'http') {
    fetchPage = withFetchFallback(fetchPage, httpFetch);
  }

  const fetchPageWithReaders = createSpecialContentResolver({
    readers: [createGithubReader({ fetchImpl }), createPdfReader({ fetchImpl }), createYoutubeReader({ fetchImpl })],
    fallback: fetchPage
  });

  const headlessPage = (url: string) =>
    proxyBrowserOptions ? headlessFetch(url, { proxy: proxyBrowserOptions }) : headlessFetch(url);

  return {
    search,
    fetchPage: fetchPageWithReaders,
    headlessFetch: createHeadlessFetch({ fetchPage: headlessPage })
  };
}
