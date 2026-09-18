import { classifyEnvelopeFailure } from '../backends/provider-failure.js';
import { createJsonSearchProvider, normalizeResultsArray } from './json-provider.js';

/** Vendors behind a Google SERP endpoint key the same header (`X-API-KEY` in Serper's spelling, `X-API-Key` here — headers are case-insensitive). */
const DEFAULT_KEY_HEADER = 'X-API-Key';

/**
 * A vendor-neutral Google SERP backend: point `backends.search.baseUrl` at any
 * vendor that front-ends Google results, put its key in
 * PI_WEB_AGENT_GOOGLE_SERP_API_KEY, and the provider id stays the same, so
 * switching vendors is a base-URL change rather than a config migration.
 *
 * The profile implemented here is the common one: POST `{ q, num }`, key in a
 * header, `organic[]` of `{ title, link, snippet }` back. SerpApi needs the key
 * as a query parameter and returns `organic_results`, so it is a separate
 * profile rather than part of this one.
 */
export function createGoogleSerpSearchTool({
  baseUrl,
  apiKey,
  keyHeader = DEFAULT_KEY_HEADER,
  fetchImpl = fetch
}: {
  baseUrl: string;
  apiKey?: string;
  keyHeader?: string;
  fetchImpl?: typeof fetch;
}) {
  return createJsonSearchProvider({
    name: 'google-serp',
    label: 'Google SERP',
    apiKey,
    missingKeyMessage: 'Google SERP search requires PI_WEB_AGENT_GOOGLE_SERP_API_KEY.',
    fetchImpl,
    request: (query) => ({
      url: baseUrl,
      init: {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', [keyHeader]: apiKey ?? '' },
        body: JSON.stringify({ q: query, num: 10 })
      }
    }),
    normalize: (json) => normalizeResultsArray(json, (body) => body.organic, 'snippet', 'link'),
    // These vendors answer 200 with a non-zero `status` when the key or the balance
    // is the problem, so a 2xx body still has to be able to fail.
    bodyFailure: classifyEnvelopeFailure
  });
}
