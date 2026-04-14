import { fetchDuckDuckGoHtml, parseDuckDuckGoResults } from '../search/duckduckgo.js';
import type { WebSearchResponse } from '../types.js';

export function createWebSearchTool({
  searchHtml = fetchDuckDuckGoHtml
}: {
  searchHtml?: (query: string) => Promise<string>;
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

    try {
      const html = await searchHtml(normalizedQuery);
      return {
        status: 'ok',
        results: parseDuckDuckGoResults(html),
        metadata: { backend: 'duckduckgo', cacheHit: false }
      };
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
