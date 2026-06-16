import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { SearchResult, WebSearchResponse } from '../types.js';

type BraveWebResult = {
  title?: unknown;
  url?: unknown;
  description?: unknown;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveWebResult[];
  };
};

const BRAVE_WEB_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

function resultWithPresentation(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

function normalizeResults(response: BraveSearchResponse): SearchResult[] {
  return (response.web?.results ?? []).flatMap((item) => {
    if (typeof item.title !== 'string' || typeof item.url !== 'string') {
      return [];
    }

    return [
      {
        title: item.title,
        url: item.url,
        snippet: typeof item.description === 'string' ? item.description : ''
      }
    ];
  });
}

function buildBraveUrl(query: string) {
  const url = new URL(BRAVE_WEB_SEARCH_URL);
  url.searchParams.set('q', query);
  return url.toString();
}

export function createBraveSearchTool({
  apiKey,
  fetchImpl = fetch
}: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}) {
  return async function braveSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'brave', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      });
    }

    if (!apiKey?.trim()) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'brave', cacheHit: false },
        error: {
          code: 'BACKEND_CONFIG_INVALID',
          message: 'Brave search requires PI_WEB_AGENT_BRAVE_API_KEY.'
        }
      });
    }

    try {
      const response = await fetchImpl(buildBraveUrl(normalizedQuery), {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as BraveSearchResponse;
      const results = normalizeResults(parsed);

      if (results.length === 0) {
        return resultWithPresentation({
          status: 'error',
          results: [],
          metadata: { backend: 'brave', cacheHit: false },
          error: { code: 'NO_RESULTS', message: 'Brave returned no usable results for this query.' }
        });
      }

      return resultWithPresentation({
        status: 'ok',
        results,
        metadata: { backend: 'brave', cacheHit: false }
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'brave', cacheHit: false },
        error: { code: 'FETCH_FAILED', message: `Brave search request failed: ${rawMessage}` }
      });
    }
  };
}
