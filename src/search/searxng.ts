import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { SearchResult, WebSearchResponse } from '../types.js';

type SearxngResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

type SearxngResponse = {
  results?: SearxngResult[];
};

function buildSearchUrl(baseUrl: string, query: string) {
  const url = new URL('/search', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  return url.toString();
}

function normalizeResults(response: SearxngResponse): SearchResult[] {
  return (response.results ?? []).flatMap((result) => {
    if (typeof result.title !== 'string' || typeof result.url !== 'string') {
      return [];
    }

    return [
      {
        title: result.title,
        url: result.url,
        snippet: typeof result.content === 'string' ? result.content : ''
      }
    ];
  });
}

export function createSearxngSearchTool({
  baseUrl,
  fetchImpl = fetch
}: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}) {
  return async function searxngSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      const result: WebSearchResponse = {
        status: 'error',
        results: [],
        metadata: { backend: 'searxng', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      };
      return { ...result, presentation: buildSearchPresentation(result) };
    }

    try {
      const response = await fetchImpl(buildSearchUrl(baseUrl, normalizedQuery));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as SearxngResponse;
      const results = normalizeResults(parsed);
      const result: WebSearchResponse = results.length > 0
        ? {
            status: 'ok',
            results,
            metadata: { backend: 'searxng', cacheHit: false }
          }
        : {
            status: 'error',
            results: [],
            metadata: { backend: 'searxng', cacheHit: false },
            error: { code: 'NO_RESULTS', message: 'SearXNG returned no usable results for this query.' }
          };

      return { ...result, presentation: buildSearchPresentation(result) };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const result: WebSearchResponse = {
        status: 'error',
        results: [],
        metadata: { backend: 'searxng', cacheHit: false },
        error: { code: 'FETCH_FAILED', message: `SearXNG search request failed: ${rawMessage}` }
      };
      return { ...result, presentation: buildSearchPresentation(result) };
    }
  };
}
