import { classifyHttpFailure, readResponseParts } from '../backends/provider-failure.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { FailureInfo, SearchProviderName, SearchResult, WebSearchResponse } from '../types.js';

export type Normalized = { rawCount: number; results: SearchResult[] };

export type JsonSearchProviderOptions = {
  name: Exclude<SearchProviderName, 'duckduckgo'>;
  label: string;
  /** Omit for providers that need no key (SearXNG, keyless Tavily). */
  apiKey?: string;
  requiresKey?: boolean;
  missingKeyMessage?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  request: (query: string) => { url: string; init?: RequestInit };
  /** Returns undefined when the body does not have the documented shape. */
  normalize: (json: unknown) => Normalized | undefined;
  /** A 200 that is empty only because the provider degraded (e.g. SearXNG engines suspended). */
  isDegradedEmpty?: (json: unknown) => boolean;
};

function respond(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

/**
 * Classifies only; the fallback policy decides what to do (#55).
 * Valid empty responses are `ok` with `[]`; anything malformed or degraded is `bad_response`.
 */
export function createJsonSearchProvider(options: JsonSearchProviderOptions) {
  const { name, label, fetchImpl = fetch, now = Date.now } = options;
  const requiresKey = options.requiresKey ?? true;

  const error = (code: string, message: string, failure: FailureInfo) =>
    respond({ status: 'error', results: [], metadata: { backend: name, cacheHit: false }, error: { code, message, failure } });

  return async function search({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return error('INVALID_QUERY', 'Query must not be empty.', { kind: 'bad_request' });
    }
    if (requiresKey && !options.apiKey?.trim()) {
      return error('BACKEND_CONFIG_INVALID', options.missingKeyMessage ?? `${label} search is not configured.`, {
        kind: 'not_configured'
      });
    }

    const { url, init } = options.request(normalizedQuery);
    let response: Response;
    try {
      // No init for plain GETs, so callers and tests see fetch(url) exactly.
      response = await (init ? fetchImpl(url, init) : fetchImpl(url));
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return error('FETCH_FAILED', `${label} search request failed: ${message}`, { kind: 'transient' });
    }

    const parts = await readResponseParts(response);
    if (!response.ok) {
      return error('FETCH_FAILED', `${label} search request failed: HTTP ${response.status}`, classifyHttpFailure(name, parts, now()));
    }

    const normalized = parts.json === undefined ? undefined : options.normalize(parts.json);
    if (!normalized || (normalized.rawCount > 0 && normalized.results.length === 0)) {
      return error('BAD_RESPONSE', `${label} returned a response that did not match the expected format.`, {
        kind: 'bad_response',
        httpStatus: response.status
      });
    }
    if (normalized.results.length === 0 && options.isDegradedEmpty?.(parts.json)) {
      return error('BAD_RESPONSE', `${label} returned no results because some of its sources were unavailable.`, {
        kind: 'bad_response',
        httpStatus: response.status
      });
    }

    return respond({ status: 'ok', results: normalized.results, metadata: { backend: name, cacheHit: false } });
  };
}

/** Shared normalizer for `{ results: [{ title, url, <snippetField> }] }` bodies. */
export function normalizeResultsArray(json: unknown, arrayPath: (body: any) => unknown, snippetField: string): Normalized | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const raw = arrayPath(json);
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return undefined;
  return {
    rawCount: raw.length,
    results: raw.flatMap((item: any) =>
      item && typeof item.title === 'string' && typeof item.url === 'string'
        ? [{ title: item.title, url: item.url, snippet: typeof item[snippetField] === 'string' ? item[snippetField] : '' }]
        : []
    )
  };
}
