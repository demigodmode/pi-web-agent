import { createFirecrawlFetcher } from '../fetch/firecrawl-fetch.js';
import { createHttpFetcher } from '../fetch/http-fetch.js';
import { createProxyFetch, resolveProxyCredentials } from '../fetch/proxy-fetch.js';
import { headlessFetch } from '../fetch/headless-fetch.js';
import { createGuardedFetch } from '../fetch/guarded-fetch.js';
import { startGuardProxy, type GuardProxy, type GuardProxyOptions } from '../fetch/guard-proxy.js';
import { createGuardProxyFetch, type GuardProxyFetch } from '../fetch/guard-proxy-fetch.js';
import { createNetworkGuard, findGuardError, type NetworkGuard } from '../fetch/network-guard.js';
import { createBraveSearchTool } from '../search/brave.js';
import { createYouComSearchTool } from '../search/youcom.js';
import { fetchDuckDuckGoHtml } from '../search/duckduckgo.js';
import { createExaSearchTool } from '../search/exa.js';
import { createTavilySearchTool } from '../search/tavily.js';
import { createSearxngSearchTool } from '../search/searxng.js';
import { createFanoutSearch } from '../search/fanout.js';
import { chainSearch, withFetchPolicy, withSearchPolicy, type PolicyDeps } from './fallback-policy.js';
import { createProviderHealth, type ProviderHealth } from './provider-health.js';
import { buildFetchPresentation } from '../presentation/fetch-presentation.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { createWebFetchHeadlessTool } from '../tools/web-fetch-headless.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createWebSearchTool } from '../tools/web-search.js';
import type { SearchProviderName, WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
import { DEFAULT_BACKEND_CONFIG, isValidProxyUrl, stripProxyCredentials, type BackendConfig, type ProxyConfig, usableSearchProviders } from './config.js';
import { createSpecialContentResolver } from '../readers/resolver.js';
import { createGithubReader } from '../readers/github-reader.js';
import { createPdfReader } from '../readers/pdf-reader.js';
import { createYoutubeReader } from '../readers/youtube-reader.js';

export type BackendSet = {
  search: (input: { query: string }) => Promise<WebSearchResponse>;
  fetchPage: (input: { url: string }) => Promise<WebFetchResponse>;
  headlessFetch: (input: { url: string }) => Promise<WebFetchHeadlessResponse>;
  /** Releases the guard proxy and its agents. Idempotent; never starts the proxy. */
  close: () => Promise<void>;
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
  networkGuard?: NetworkGuard;
  /** Test seam: the fetch used for model-chosen URLs, before redirect handling. */
  createModelFetch?: (guard: NetworkGuard) => typeof fetch;
  createGuardProxy?: (options: GuardProxyOptions) => Promise<GuardProxy>;
  providerHealth?: ProviderHealth;
  /** Test seam for the retry sleep, jitter, and clock. */
  policy?: Omit<PolicyDeps, 'health'>;
};

function invalidSearxngSearch() {
  return async function search() {
    const result: WebSearchResponse = {
      status: 'error',
      results: [],
      metadata: { backend: 'searxng', cacheHit: false },
      error: {
        code: 'BACKEND_CONFIG_INVALID',
        message: 'SearXNG search requires backends.search.baseUrl.',
        failure: { kind: 'not_configured' }
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
        message: 'Firecrawl fetch requires backends.fetch.baseUrl.',
        failure: { kind: 'not_configured' }
      }
    };

    return { ...result, presentation: buildFetchPresentation(result) };
  };
}

/**
 * Checks the target URL before dispatching to the http fetcher, a content
 * reader, or Firecrawl. Doing it here means a private URL is refused once, in
 * one place, and never reaches Firecrawl or its http fallback (#53).
 */
function withTargetGuard(
  fetchPage: BackendSet['fetchPage'],
  guard: NetworkGuard,
  method: 'http' | 'firecrawl'
): BackendSet['fetchPage'] {
  return async (input) => {
    try {
      await guard.assertUrlAllowed(input.url);
    } catch (error) {
      const blocked = findGuardError(error);
      if (!blocked) throw error;
      const result: WebFetchResponse = {
        status: 'error',
        url: input.url,
        metadata: { method, cacheHit: false },
        error: { code: blocked.code, message: blocked.message, failure: { kind: 'guard_refused' } }
      };
      return { ...result, presentation: buildFetchPresentation(result) };
    }
    return fetchPage(input);
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

  // A blank url is the "disable proxy" marker: treat it as no proxy at all.
  const proxy = config.proxy && config.proxy.url.trim() !== '' ? config.proxy : undefined;

  // A configured proxy whose url fails validation must not be silently ignored
  // — that would send traffic direct to the websites. Every request errors out
  // instead. No connectivity check is needed: the url itself is the problem.
  if (proxy && !isValidProxyUrl(proxy.url)) {
    const message =
      `backends.proxy.url (${proxy.url}) is not a valid http or https URL. ` +
      'Web requests are blocked until it is fixed; set backends.proxy.url to "" to disable the proxy.';
    return {
      search: async () => {
        const result: WebSearchResponse = {
          status: 'error',
          results: [],
          metadata: { backend: config.search.provider, cacheHit: false },
          error: { code: 'BACKEND_CONFIG_INVALID', message, failure: { kind: 'config_global' } }
        };
        return { ...result, presentation: buildSearchPresentation(result) };
      },
      fetchPage: async ({ url }) => {
        const result: WebFetchResponse = {
          status: 'error',
          url,
          metadata: { method: 'http', cacheHit: false },
          error: { code: 'BACKEND_CONFIG_INVALID', message, failure: { kind: 'config_global' } }
        };
        return { ...result, presentation: buildFetchPresentation(result) };
      },
      headlessFetch: async ({ url }) => {
        const result: WebFetchHeadlessResponse = {
          status: 'error',
          url,
          metadata: { method: 'headless', cacheHit: false },
          error: { code: 'BACKEND_CONFIG_INVALID', message, failure: { kind: 'config_global' } }
        };
        return { ...result, presentation: buildFetchPresentation(result) };
      },
      close: async () => undefined
    };
  }

  // When a proxy is configured, every outbound HTTP request goes through it.
  // User-configured endpoints use fetchImpl directly; model-chosen fetches and
  // the headless browser reach it through the guard proxy below.
  const fetchImpl: typeof fetch = proxy ? makeProxyFetch(proxy) : fetch;
  const proxyCredentials = proxy ? resolveProxyCredentials(proxy) : undefined;

  // Model-chosen URLs only. Search APIs and the configured SearXNG/Firecrawl
  // endpoints keep using fetchImpl: the user typed those (#53).
  const networkGuard = deps.networkGuard ?? createNetworkGuard({ allowRanges: config.network?.allowRanges ?? [] });

  // One guard proxy per backend set, started on first use. It is the single
  // place the address policy is enforced, for Node fetches and the browser,
  // and it chains to the user's upstream proxy itself.
  let guardProxy: Promise<GuardProxy> | undefined;
  let isClosed = false;
  const getGuardProxy = () => {
    if (isClosed) return Promise.reject(new Error('Backend set is closed.'));
    if (guardProxy) return guardProxy;
    const started = (deps.createGuardProxy ?? startGuardProxy)({
      guard: networkGuard,
      ...(proxy
        ? {
            upstream: {
              url: stripProxyCredentials(proxy.url),
              ...(proxyCredentials?.username !== undefined ? { username: proxyCredentials.username } : {}),
              ...(proxyCredentials?.password !== undefined ? { password: proxyCredentials.password } : {})
            }
          }
        : {}),
      trustProxyDns: config.network?.trustProxyDns === true
    });
    guardProxy = started;
    // A failed start should not stick around for the rest of the backend
    // set's life: clear it so the next call tries again, unless a newer
    // attempt has already replaced it.
    started.catch(() => {
      if (guardProxy === started) guardProxy = undefined;
    });
    return started;
  };

  const modelFetch: typeof fetch | GuardProxyFetch = deps.createModelFetch
    ? deps.createModelFetch(networkGuard)
    : createGuardProxyFetch(getGuardProxy);
  const targetFetch = createGuardedFetch(modelFetch, networkGuard);

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      isClosed = true;
      if ('close' in modelFetch) await (modelFetch as GuardProxyFetch).close();
      if (guardProxy) {
        const started = await guardProxy.catch(() => undefined);
        await started?.close().catch(() => undefined);
      }
    })());

  // One health state per backend set: a rebuilt set (config change) starts fresh.
  const policyDeps: PolicyDeps = { health: deps.providerHealth ?? createProviderHealth(deps.policy?.now ? { now: deps.policy.now } : {}), ...deps.policy };
  const guarded = (name: SearchProviderName, search: BackendSet['search'], healthKey?: string) =>
    withSearchPolicy(name, search, policyDeps, healthKey);

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

  const primarySearch = guarded(config.search.provider, buildProviderSearch(config.search.provider));
  const chain: BackendSet['search'][] = [primarySearch];
  if (config.search.provider !== 'duckduckgo' && config.search.fallback === 'duckduckgo') {
    chain.push(guarded('duckduckgo', createDuckDuckGo()));
  }
  let search: BackendSet['search'] = chainSearch(chain, policyDeps);

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
      providers: ordered.map((name) => ({ name, search: guarded(name, buildProviderSearch(name)) })),
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
    // chainSearch only falls back on non-terminal failures, so a terminal result or bad_request never reaches keyless Tavily.
    search = chainSearch([search, guarded('tavily', createTavilySearch({ keyless: true, fetchImpl }), 'tavily-keyless')], policyDeps);
  }

  const httpFetch = createHttpFetch({ fetchPage: createHttpFetcher({ fetchImpl: targetFetch }) });
  const fetchPage: BackendSet['fetchPage'] =
    config.fetch.provider === 'firecrawl'
      ? withFetchPolicy(
          config.fetch.baseUrl
            ? createHttpFetch({
                fetchPage: createFirecrawlFetch({
                  baseUrl: config.fetch.baseUrl,
                  apiKey: config.fetch.apiKey ?? process.env.PI_WEB_AGENT_FIRECRAWL_API_KEY,
                  options: config.fetch.options,
                  fetchImpl
                })
              })
            : createHttpFetch({ fetchPage: invalidFirecrawlFetch() }),
          config.fetch.fallback === 'http' ? httpFetch : undefined,
          policyDeps
        )
      : httpFetch;

  const fetchPageWithReaders = createSpecialContentResolver({
    readers: [
      createGithubReader({ fetchImpl: targetFetch }),
      createPdfReader({ fetchImpl: targetFetch }),
      createYoutubeReader({ fetchImpl: targetFetch })
    ],
    fallback: fetchPage
  });

  const headlessPage = (url: string) => headlessFetch(url, { guard: networkGuard, guardProxy: getGuardProxy });

  return {
    search,
    fetchPage: withTargetGuard(fetchPageWithReaders, networkGuard, config.fetch.provider === 'firecrawl' ? 'firecrawl' : 'http'),
    headlessFetch: createHeadlessFetch({ fetchPage: headlessPage }),
    close
  };
}
