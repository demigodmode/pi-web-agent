import { createCacheKey, createTtlCache } from '../cache/ttl-cache.js';
import { fetchDuckDuckGoHtml, parseDuckDuckGoResults } from '../search/duckduckgo.js';
import type { WebSearchResponse } from '../types.js';

export function createWebSearchTool({
  searchHtml = fetchDuckDuckGoHtml,
  cache = createTtlCache<WebSearchResponse>({ ttlMs: 30_000 })
}: {
  searchHtml?: (query: string) => Promise<string>;
  cache?: {
    get(key: string): WebSearchResponse | undefined;
    set(key: string, value: WebSearchResponse): void;
  };
} = {}) {
  return async function webSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      };
    }

    const cacheKey = createCacheKey(['web_search', normalizedQuery]);
    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        metadata: { ...cached.metadata, cacheHit: true }
      };
    }

    try {
      const html = await searchHtml(normalizedQuery);
      const result: WebSearchResponse = {
        status: 'ok',
        results: parseDuckDuckGoResults(html),
        metadata: { backend: 'duckduckgo', cacheHit: false }
      };
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      return {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: {
          code: 'SEARCH_FAILED',
          message: error instanceof Error ? error.message : 'Unknown search failure.'
        }
      };
    }
  };
}
