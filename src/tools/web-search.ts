import { createCacheKey, createTtlCache } from '../cache/ttl-cache.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { classifyHttpFailure } from '../backends/provider-failure.js';
import { DuckDuckGoHttpError, fetchDuckDuckGoHtml, parseDuckDuckGoResults } from '../search/duckduckgo.js';
import type { WebSearchResponse } from '../types.js';

function respond(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

function htmlLooksBlocked(html: string) {
  const normalized = html.toLowerCase();

  return (
    normalized.includes('captcha') ||
    normalized.includes('challenge') ||
    normalized.includes('verify you are human') ||
    normalized.includes('are you a robot') ||
    normalized.includes('unusual traffic') ||
    normalized.includes('automated requests') ||
    normalized.includes('automated queries') ||
    normalized.includes('detected unusual') ||
    normalized.includes('too many requests')
  );
}

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
      return respond({
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.', failure: { kind: 'bad_request' } }
      });
    }

    const cacheKey = createCacheKey(['web_search', normalizedQuery]);
    const cached = cache.get(cacheKey);
    if (cached) {
      return respond({ ...cached, metadata: { ...cached.metadata, cacheHit: true } });
    }

    let html: string;
    try {
      html = await searchHtml(normalizedQuery);
    } catch (error) {
      const failure =
        error instanceof DuckDuckGoHttpError
          ? classifyHttpFailure('duckduckgo', { status: error.status, headers: error.headers })
          : { kind: 'transient' as const };
      const blockedLike = failure.kind === 'blocked' || failure.kind === 'rate_limited';
      return respond({
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: {
          code: blockedLike ? 'BLOCKED' : 'FETCH_FAILED',
          message: blockedLike
            ? 'DuckDuckGo search appears to be blocked or rate limited.'
            : `DuckDuckGo search request failed: ${error instanceof Error ? error.message : String(error)}`,
          failure
        }
      });
    }

    const parsed = parseDuckDuckGoResults(html);

    if (parsed.results.length > 0) {
      const result: WebSearchResponse = { status: 'ok', results: parsed.results, metadata: { backend: 'duckduckgo', cacheHit: false } };
      cache.set(cacheKey, result);
      return respond(result);
    }

    // Bot-wall check first: a page can carry both markers, and blocked routes to fallback.
    const walled = htmlLooksBlocked(html) || (!parsed.hasResultContainers && !parsed.noResults);
    if (walled) {
      return respond({
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: {
          code: 'BLOCKED',
          message: 'DuckDuckGo search appears to be blocked or rate limited.',
          failure: { kind: 'blocked' }
        }
      });
    }

    // DuckDuckGo said there are no results, or every result was filtered out: a valid empty search.
    return respond({ status: 'ok', results: [], metadata: { backend: 'duckduckgo', cacheHit: false } });
  };
}
