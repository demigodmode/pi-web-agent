import { createJsonSearchProvider, type Normalized } from './json-provider.js';

export const DEGOOG_API_KEY_ENV = 'PI_WEB_AGENT_DEGOOG_API_KEY';

type EngineTiming = { name?: unknown; status?: unknown; errorReason?: unknown; resultCount?: unknown };

/**
 * Builds an API URL under the instance root. A pasted `/api/search` or `/search` (any case) is
 * dropped, trailing slashes too, and any other sub-path stays. A query or fragment on the base
 * URL is ignored.
 */
export function degoogApiUrl(baseUrl: string, path: 'api/search' | 'api/engines', params: Record<string, string> = {}): string {
  const url = new URL(baseUrl.trim());
  url.search = '';
  url.hash = '';
  const root = url.pathname.replace(/\/+$/, '').replace(/\/(api\/search|search)$/i, '').replace(/\/+$/, '');
  url.pathname = `${root}/${path}`;
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

/** The key is optional; the header only goes out when there is one. */
export function degoogHeaders(apiKey?: string): Record<string, string> {
  const key = apiKey?.trim();
  return key ? { Accept: 'application/json', Authorization: `Bearer ${key}` } : { Accept: 'application/json' };
}

export function engineTimingsOf(json: unknown): EngineTiming[] | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const timings = (json as { engineTimings?: unknown }).engineTimings;
  return Array.isArray(timings) ? timings.map((t) => (t && typeof t === 'object' ? (t as EngineTiming) : {})) : undefined;
}

/**
 * An engine failed when its status is not ok, or when it is "ok" but reports an error reason
 * with no results (misconfigured engines show up that way). ok with no reason and zero results
 * is just an empty answer.
 */
export function isFailedTiming(timing: EngineTiming): boolean {
  if (timing.status !== 'ok') return true;
  return typeof timing.errorReason === 'string' && timing.errorReason !== '' && timing.resultCount === 0;
}

/** True when there were engines to ask and every one of them failed. */
export function allEnginesFailed(timings: EngineTiming[]): boolean {
  return timings.length > 0 && timings.every(isFailedTiming);
}

/** `Brave Search (rate_limited reason), DuckDuckGo (timeout)`, for doctor and error messages. */
export function describeEngineFailures(timings: EngineTiming[]): string {
  return timings
    .map((t) => {
      const name = typeof t.name === 'string' ? t.name : 'engine';
      const reason = typeof t.errorReason === 'string' ? t.errorReason : typeof t.status === 'string' ? t.status : 'failed';
      return `${name} (${reason})`;
    })
    .join(', ');
}

/** Native shape first; a SearXNG-shaped body (format=json) still has `results`, so it reads the same way. */
function normalizeDegoog(json: unknown): Normalized | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const raw = (json as { results?: unknown }).results;
  if (!Array.isArray(raw)) return undefined;
  return {
    rawCount: raw.length,
    results: raw.flatMap((item: unknown) => {
      const r = item as { title?: unknown; url?: unknown; snippet?: unknown; content?: unknown } | null;
      if (!r || typeof r.title !== 'string' || typeof r.url !== 'string') return [];
      const snippet = typeof r.snippet === 'string' ? r.snippet : typeof r.content === 'string' ? r.content : '';
      return [{ title: r.title, url: r.url, snippet }];
    })
  };
}

export function createDegoogSearchTool({
  baseUrl,
  apiKey,
  fetchImpl = fetch
}: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}) {
  return createJsonSearchProvider({
    name: 'degoog',
    label: 'Degoog',
    requiresKey: false,
    fetchImpl,
    // No `format` param: with format=json the instance may answer in SearXNG shape.
    request: (query) => ({
      url: degoogApiUrl(baseUrl, 'api/search', { q: query }),
      init: { headers: degoogHeaders(apiKey) }
    }),
    normalize: normalizeDegoog,
    httpFailureMessage: (status) => {
      if (status === 401) {
        return apiKey?.trim()
          ? 'Degoog search request failed: HTTP 401. The key in PI_WEB_AGENT_DEGOOG_API_KEY was rejected.'
          : 'Degoog search request failed: HTTP 401. The instance wants an API key; set PI_WEB_AGENT_DEGOOG_API_KEY.';
      }
      if (status === 404) return 'Degoog search request failed: HTTP 404. Check the base URL.';
      return undefined;
    },
    badResponseMessage: 'Degoog returned something other than search results. Check the base URL.',
    // Every engine failed with a 200: the same idea as SearXNG's unresponsive_engines.
    isDegradedEmpty: (json) => {
      const timings = engineTimingsOf(json);
      return timings !== undefined && allEnginesFailed(timings);
    },
    degradedMessage: (json) =>
      `Degoog returned no results because its engines failed: ${describeEngineFailures(engineTimingsOf(json) ?? [])}.`
  });
}
