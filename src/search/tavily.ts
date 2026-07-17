import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { SearchResult, WebSearchResponse } from '../types.js';

type TavilySearchResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

type TavilySearchResponse = {
  results?: TavilySearchResult[];
};

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

function resultWithPresentation(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

function normalizeResults(response: TavilySearchResponse): SearchResult[] {
  return (response.results ?? []).flatMap((item) => {
    if (typeof item.title !== 'string' || typeof item.url !== 'string') {
      return [];
    }

    return [
      {
        title: item.title,
        url: item.url,
        snippet: typeof item.content === 'string' ? item.content : ''
      }
    ];
  });
}

export function createTavilySearchTool({
  apiKey,
  fetchImpl = fetch
}: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}) {
  return async function tavilySearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'tavily', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      });
    }

    if (!apiKey?.trim()) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'tavily', cacheHit: false },
        error: {
          code: 'BACKEND_CONFIG_INVALID',
          message: 'Tavily search requires TAVILY_API_KEY.'
        }
      });
    }

    try {
      const response = await fetchImpl(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ query: normalizedQuery, max_results: 10 })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as TavilySearchResponse;
      const results = normalizeResults(parsed);

      if (results.length === 0) {
        return resultWithPresentation({
          status: 'error',
          results: [],
          metadata: { backend: 'tavily', cacheHit: false },
          error: { code: 'NO_RESULTS', message: 'Tavily returned no usable results for this query.' }
        });
      }

      return resultWithPresentation({
        status: 'ok',
        results,
        metadata: { backend: 'tavily', cacheHit: false }
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'tavily', cacheHit: false },
        error: { code: 'FETCH_FAILED', message: `Tavily search request failed: ${rawMessage}` }
      });
    }
  };
}
