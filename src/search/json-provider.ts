import { classifyHttpFailure, readResponseParts, type EnvelopeFailure } from '../backends/provider-failure.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { FailureInfo, SearchInput, SearchProviderName, SearchResult, WebSearchResponse } from '../types.js';

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
  /** Reads a body that is not plain JSON, e.g. the SSE framing an MCP endpoint may answer with. */
  decodeBody?: (parts: { text: string; headers: Headers }) => unknown;
  /** Returns undefined when the body does not have the documented shape. */
  normalize: (json: unknown) => Normalized | undefined;
  /** A 200 that is empty only because the provider degraded (e.g. SearXNG engines suspended). */
  isDegradedEmpty?: (json: unknown) => boolean;
  /** Wording for a degraded empty response; the generic sentence when omitted. */
  degradedMessage?: (json: unknown) => string;
  /** Full wording for a non-2xx status, when the default needs a hint (which env var, which setting). */
  httpFailureMessage?: (status: number) => string | undefined;
  /** Replaces the generic "did not match the expected format" wording. */
  badResponseMessage?: string;
  /** Providers that report the failure inside a 2xx body instead of a 4xx (see classifyEnvelopeFailure). */
  bodyFailure?: (json: unknown) => EnvelopeFailure | undefined;
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

  return async function search({ query, signal }: SearchInput): Promise<WebSearchResponse> {
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
    const requestInit = signal ? { ...init, signal } : init;
    let response: Response;
    try {
      // No init for plain GETs, so callers and tests see fetch(url) exactly.
      response = await (requestInit ? fetchImpl(url, requestInit) : fetchImpl(url));
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return error('FETCH_FAILED', `${label} search request failed: ${message}`, { kind: 'transient' });
    }

    let parts: Awaited<ReturnType<typeof readResponseParts>>;
    try {
      parts = await readResponseParts(response);
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return error('FETCH_FAILED', `${label} search response could not be read: ${message}`, { kind: 'transient' });
    }
    if (!response.ok) {
      const message = options.httpFailureMessage?.(response.status) ?? `${label} search request failed: HTTP ${response.status}`;
      return error('FETCH_FAILED', message, classifyHttpFailure(name, parts, now()));
    }

    const badResponse = () =>
      error(
        'BAD_RESPONSE',
        options.badResponseMessage ?? `${label} returned a response that did not match the expected format.`,
        { kind: 'bad_response', httpStatus: response.status }
      );

    const body = parts.json === undefined ? options.decodeBody?.(parts) : parts.json;

    // A 2xx whose body reports the failure: still a provider failure, and the kind
    // matters to the fallback policy (#55), so it must not collapse into bad_response.
    // Checked before normalizing: an error envelope with an empty (or partially filled)
    // `organic` array would otherwise be reported as a successful, empty search.
    const envelope = body === undefined ? undefined : options.bodyFailure?.(body);
    if (envelope) {
      return error('FETCH_FAILED', `${label} search request failed: ${envelope.message}.`, envelope.failure);
    }

    const normalized = body === undefined ? undefined : options.normalize(body);
    if (!normalized) return badResponse();
    if (normalized.rawCount > 0 && normalized.results.length === 0) return badResponse();
    if (normalized.results.length === 0 && options.isDegradedEmpty?.(body)) {
      const message = options.degradedMessage?.(body) ?? `${label} returned no results because some of its sources were unavailable.`;
      return error('BAD_RESPONSE', message, { kind: 'bad_response', httpStatus: response.status });
    }

    return respond({ status: 'ok', results: normalized.results, metadata: { backend: name, cacheHit: false } });
  };
}

/**
 * Shared normalizer for `{ results: [{ title, url, <snippetField> }] }` bodies.
 * `urlField` covers vendors that call the link something else (`link`, `displayLink`).
 */
export function normalizeResultsArray(
  json: unknown,
  arrayPath: (body: any) => unknown,
  snippetField: string,
  urlField = 'url'
): Normalized | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const raw = arrayPath(json);
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return undefined;
  return {
    rawCount: raw.length,
    results: raw.flatMap((item: any) =>
      item && typeof item.title === 'string' && typeof item[urlField] === 'string'
        ? [{ title: item.title, url: item[urlField], snippet: typeof item[snippetField] === 'string' ? item[snippetField] : '' }]
        : []
    )
  };
}
