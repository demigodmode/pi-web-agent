import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { SearchResult, WebSearchResponse } from '../types.js';

type ExaSearchResult = {
  title?: unknown;
  url?: unknown;
  text?: unknown;
};

type ExaSearchResponse = {
  results?: ExaSearchResult[];
};

const EXA_SEARCH_URL = 'https://api.exa.ai/search';

function resultWithPresentation(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

function normalizeResults(response: ExaSearchResponse): SearchResult[] {
  return (response.results ?? []).flatMap((item) => {
    if (typeof item.title !== 'string' || typeof item.url !== 'string') {
      return [];
    }

    return [
      {
        title: item.title,
        url: item.url,
        snippet: typeof item.text === 'string' ? item.text : ''
      }
    ];
  });
}

export function createExaSearchTool({
  apiKey,
  fetchImpl = fetch
}: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}) {
  return async function exaSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'exa', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      });
    }

    if (!apiKey?.trim()) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'exa', cacheHit: false },
        error: {
          code: 'BACKEND_CONFIG_INVALID',
          message: 'Exa search requires EXA_API_KEY.'
        }
      });
    }

    try {
      const response = await fetchImpl(EXA_SEARCH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({ query: normalizedQuery, numResults: 10 })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as ExaSearchResponse;
      const results = normalizeResults(parsed);

      if (results.length === 0) {
        return resultWithPresentation({
          status: 'error',
          results: [],
          metadata: { backend: 'exa', cacheHit: false },
          error: { code: 'NO_RESULTS', message: 'Exa returned no usable results for this query.' }
        });
      }

      return resultWithPresentation({
        status: 'ok',
        results,
        metadata: { backend: 'exa', cacheHit: false }
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'exa', cacheHit: false },
        error: { code: 'FETCH_FAILED', message: `Exa search request failed: ${rawMessage}` }
      });
    }
  };
}
