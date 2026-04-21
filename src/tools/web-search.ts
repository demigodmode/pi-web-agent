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
      const parsed = parseDuckDuckGoResults(html);

      if (parsed.results.length > 0) {
        const result: WebSearchResponse = {
          status: 'ok',
          results: parsed.results,
          metadata: { backend: 'duckduckgo', cacheHit: false }
        };
        cache.set(cacheKey, result);
        return result;
      }

      if (parsed.noResults) {
        return {
          status: 'error',
          results: [],
          metadata: { backend: 'duckduckgo', cacheHit: false },
          error: {
            code: 'NO_RESULTS',
            message: 'DuckDuckGo returned no usable results for this query.'
          }
        };
      }

      return {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: {
          code: 'PARSE_FAILED',
          message: 'DuckDuckGo returned a page, but it did not match the expected results format.'
        }
      };
    } catch (error) {
      return {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: {
          code: 'FETCH_FAILED',
          message: error instanceof Error ? error.message : 'Unknown search failure.'
        }
      };
    }
  };
}
