import { createFirecrawlFetcher } from '../fetch/firecrawl-fetch.js';
import { createSearxngSearchTool } from '../search/searxng.js';
import { buildFetchPresentation } from '../presentation/fetch-presentation.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { createWebFetchHeadlessTool } from '../tools/web-fetch-headless.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createWebSearchTool } from '../tools/web-search.js';
import type { WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
import { DEFAULT_BACKEND_CONFIG, type BackendConfig } from './config.js';

export type BackendSet = {
  search: (input: { query: string }) => Promise<WebSearchResponse>;
  fetchPage: (input: { url: string }) => Promise<WebFetchResponse>;
  headlessFetch: (input: { url: string }) => Promise<WebFetchHeadlessResponse>;
};

export type BackendFactoryDeps = {
  createDuckDuckGoSearch?: typeof createWebSearchTool;
  createSearxngSearch?: typeof createSearxngSearchTool;
  createHttpFetch?: typeof createWebFetchTool;
  createFirecrawlFetch?: typeof createFirecrawlFetcher;
  createHeadlessFetch?: typeof createWebFetchHeadlessTool;
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
  fallback: BackendSet['search']
): BackendSet['search'] {
  return async (input) => {
    const first = await primary(input);
    if (first.status !== 'error') return first;

    const second = await fallback(input);
    const result: WebSearchResponse = {
      ...second,
      metadata: {
        ...second.metadata,
        fallbackFrom: 'searxng',
        fallbackReason: first.error?.message ?? 'SearXNG search failed.'
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
  const createHttpFetch = deps.createHttpFetch ?? createWebFetchTool;
  const createFirecrawlFetch = deps.createFirecrawlFetch ?? createFirecrawlFetcher;
  const createHeadlessFetch = deps.createHeadlessFetch ?? createWebFetchHeadlessTool;

  let search = config.search.provider === 'searxng'
    ? config.search.baseUrl
      ? createSearxngSearch({ baseUrl: config.search.baseUrl, options: config.search.options })
      : invalidSearxngSearch()
    : createDuckDuckGoSearch();

  if (config.search.provider === 'searxng' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGoSearch());
  }

  const httpFetch = createHttpFetch();
  let fetchPage = config.fetch.provider === 'firecrawl'
    ? config.fetch.baseUrl
      ? createHttpFetch({
          fetchPage: createFirecrawlFetch({
            baseUrl: config.fetch.baseUrl,
            apiKey: config.fetch.apiKey ?? process.env.PI_WEB_AGENT_FIRECRAWL_API_KEY,
            options: config.fetch.options
          })
        })
      : createHttpFetch({ fetchPage: invalidFirecrawlFetch() })
    : httpFetch;

  if (config.fetch.provider === 'firecrawl' && config.fetch.fallback === 'http') {
    fetchPage = withFetchFallback(fetchPage, httpFetch);
  }

  return {
    search,
    fetchPage,
    headlessFetch: createHeadlessFetch()
  };
}
