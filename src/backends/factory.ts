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

export function createBackendSet(config: BackendConfig = DEFAULT_BACKEND_CONFIG): BackendSet {
  const search = config.search.provider === 'searxng'
    ? config.search.baseUrl
      ? createSearxngSearchTool({ baseUrl: config.search.baseUrl })
      : invalidSearxngSearch()
    : createWebSearchTool();

  const fetchPage = config.fetch.provider === 'firecrawl'
    ? config.fetch.baseUrl
      ? createWebFetchTool({
          fetchPage: createFirecrawlFetcher({
            baseUrl: config.fetch.baseUrl,
            apiKey: config.fetch.apiKey ?? process.env.PI_WEB_AGENT_FIRECRAWL_API_KEY
          })
        })
      : createWebFetchTool({ fetchPage: invalidFirecrawlFetch() })
    : createWebFetchTool();

  return {
    search,
    fetchPage,
    headlessFetch: createWebFetchHeadlessTool()
  };
}
