import { createCacheKey, createTtlCache } from '../cache/ttl-cache.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { fetchDuckDuckGoHtml, parseDuckDuckGoResults } from '../search/duckduckgo.js';
import { fetchTavilyResults } from '../search/tavily.js';
import type { WebSearchResponse } from '../types.js';

export type SearchBackend = 'duckduckgo' | 'tavily' | 'auto';

function classifySearchFailure(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : 'Unknown search failure.';
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('blocked') ||
    normalized.includes('rate limit') ||
    normalized.includes('rate-limit') ||
    normalized.includes('403') ||
    normalized.includes('429') ||
    normalized.includes('captcha') ||
    normalized.includes('challenge')
  ) {
    return {
      code: 'BLOCKED',
      message: 'DuckDuckGo search appears to be blocked or rate limited.'
    };
  }

  return {
    code: 'FETCH_FAILED',
    message: `DuckDuckGo search request failed: ${rawMessage}`
  };
}

function htmlLooksBlocked(html: string) {
  const normalized = html.toLowerCase();

  return (
    normalized.includes('captcha') ||
    normalized.includes('challenge') ||
    normalized.includes('verify you are human') ||
    normalized.includes('are you a robot') ||
    normalized.includes('unusual traffic')
  );
}

async function searchWithDuckDuckGo(
  query: string,
  searchHtml: (query: string) => Promise<string>
): Promise<WebSearchResponse> {
  try {
    const html = await searchHtml(query);
    const parsed = parseDuckDuckGoResults(html);

    if (parsed.results.length > 0) {
      return {
        status: 'ok',
        results: parsed.results,
        metadata: { backend: 'duckduckgo', cacheHit: false }
      };
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

    if (htmlLooksBlocked(html)) {
      return {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: {
          code: 'BLOCKED',
          message: 'DuckDuckGo search appears to be blocked or rate limited.'
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
      error: classifySearchFailure(error)
    };
  }
}

async function searchWithTavily(
  query: string,
  cache: { get(key: string): WebSearchResponse | undefined; set(key: string, value: WebSearchResponse): void },
  cacheKey: string
): Promise<WebSearchResponse> {
  try {
    const results = await fetchTavilyResults(query);
    if (results.length === 0) {
      const result: WebSearchResponse = {
        status: 'error',
        results: [],
        metadata: { backend: 'tavily', cacheHit: false },
        error: { code: 'NO_RESULTS', message: 'Tavily returned no results for this query.' }
      };
      return { ...result, presentation: buildSearchPresentation(result) };
    }
    const result: WebSearchResponse = {
      status: 'ok',
      results,
      metadata: { backend: 'tavily', cacheHit: false }
    };
    cache.set(cacheKey, result);
    return { ...result, presentation: buildSearchPresentation(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Tavily search failure.';
    const result: WebSearchResponse = {
      status: 'error',
      results: [],
      metadata: { backend: 'tavily', cacheHit: false },
      error: { code: 'FETCH_FAILED', message: `Tavily search failed: ${message}` }
    };
    return { ...result, presentation: buildSearchPresentation(result) };
  }
}

export function createWebSearchTool({
  searchHtml = fetchDuckDuckGoHtml,
  cache = createTtlCache<WebSearchResponse>({ ttlMs: 30_000 }),
  backend = 'auto'
}: {
  searchHtml?: (query: string) => Promise<string>;
  cache?: {
    get(key: string): WebSearchResponse | undefined;
    set(key: string, value: WebSearchResponse): void;
  };
  backend?: SearchBackend;
} = {}) {
  return async function webSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      const result: WebSearchResponse = {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      };
      return {
        ...result,
        presentation: buildSearchPresentation(result)
      };
    }

    const cacheKey = createCacheKey(['web_search', normalizedQuery]);
    const cached = cache.get(cacheKey);
    if (cached) {
      const result: WebSearchResponse = {
        ...cached,
        metadata: { ...cached.metadata, cacheHit: true }
      };
      return {
        ...result,
        presentation: buildSearchPresentation(result)
      };
    }

    if (backend === 'tavily') {
      return searchWithTavily(normalizedQuery, cache, cacheKey);
    }

    const ddgResult = await searchWithDuckDuckGo(normalizedQuery, searchHtml);

    if (ddgResult.status === 'ok') {
      cache.set(cacheKey, ddgResult);
      return { ...ddgResult, presentation: buildSearchPresentation(ddgResult) };
    }

    const shouldFallback =
      backend === 'auto' &&
      ddgResult.error &&
      (ddgResult.error.code === 'BLOCKED' || ddgResult.error.code === 'PARSE_FAILED') &&
      !!process.env.TAVILY_API_KEY;

    if (shouldFallback) {
      return searchWithTavily(normalizedQuery, cache, cacheKey);
    }

    return { ...ddgResult, presentation: buildSearchPresentation(ddgResult) }
  };
}
