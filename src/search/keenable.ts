import { createJsonSearchProvider, normalizeResultsArray } from './json-provider.js';

// Keyed endpoint: https://docs.keenable.ai/api-reference/search
// X-Keenable-Title is only required on /v1/search/public, so the keyed call does not send it.
const KEENABLE_SEARCH_URL = 'https://api.keenable.ai/v1/search';
// The API caps each result's snippet server-side (allowed range 180-10000).
const SNIPPET_MAX_LENGTH = 500;

export function createKeenableSearchTool({ apiKey, fetchImpl = fetch }: { apiKey?: string; fetchImpl?: typeof fetch }) {
  return createJsonSearchProvider({
    name: 'keenable',
    label: 'Keenable',
    apiKey,
    missingKeyMessage: 'Keenable search requires KEENABLE_API_KEY.',
    fetchImpl,
    request: (query) => ({
      url: KEENABLE_SEARCH_URL,
      init: {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': apiKey ?? ''
        },
        body: JSON.stringify({ query, max_results: 10, snippet_max_length: SNIPPET_MAX_LENGTH })
      }
    }),
    // `description` is deprecated and always empty; `snippet` carries the text.
    normalize: (json) => normalizeResultsArray(json, (body) => body.results, 'snippet')
  });
}
