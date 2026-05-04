import { createFirecrawlFetcher } from '../fetch/firecrawl-fetch.js';
import { createSearxngSearchTool } from '../search/searxng.js';
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

export function createBackendSet(config: BackendConfig = DEFAULT_BACKEND_CONFIG): BackendSet {
  const search = config.search.provider === 'searxng' && config.search.baseUrl
    ? createSearxngSearchTool({ baseUrl: config.search.baseUrl })
    : createWebSearchTool();

  const fetchPage = config.fetch.provider === 'firecrawl' && config.fetch.baseUrl
    ? createWebFetchTool({
        fetchPage: createFirecrawlFetcher({
          baseUrl: config.fetch.baseUrl,
          apiKey: config.fetch.apiKey
        })
      })
    : createWebFetchTool();

  return {
    search,
    fetchPage,
    headlessFetch: createWebFetchHeadlessTool()
  };
}
