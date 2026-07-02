import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { SearchResult, WebSearchResponse } from '../types.js';

type YouComSearchResult = {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
};

type YouComSearchResponse = {
  results?: YouComSearchResult[];
};

const YOUCOM_SEARCH_URL = 'https://api.you.com/v1/agents/search';

function resultWithPresentation(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

function normalizeResults(response: YouComSearchResponse): SearchResult[] {
  return (response.results ?? []).flatMap((item) => {
    if (typeof item.title !== 'string' || typeof item.url !== 'string') {
      return [];
    }

    return [
      {
        title: item.title,
        url: item.url,
        snippet: typeof item.snippet === 'string' ? item.snippet : ''
      }
    ];
  });
}

export function createYouComSearchTool({
  apiKey,
  fetchImpl = fetch
}: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}) {
  return async function youComSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'youcom', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      });
    }

    if (!apiKey?.trim()) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'youcom', cacheHit: false },
        error: {
          code: 'BACKEND_CONFIG_INVALID',
          message: 'You.com search requires YDC_API_KEY.'
        }
      });
    }

    try {
      const response = await fetchImpl(YOUCOM_SEARCH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ query: normalizedQuery, max_results: 10 })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as YouComSearchResponse;
      const results = normalizeResults(parsed);

      if (results.length === 0) {
        return resultWithPresentation({
          status: 'error',
          results: [],
          metadata: { backend: 'youcom', cacheHit: false },
          error: { code: 'NO_RESULTS', message: 'You.com returned no usable results for this query.' }
        });
      }

      return resultWithPresentation({
        status: 'ok',
        results,
        metadata: { backend: 'youcom', cacheHit: false }
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'youcom', cacheHit: false },
        error: { code: 'FETCH_FAILED', message: `You.com search request failed: ${rawMessage}` }
      });
    }
  };
}
