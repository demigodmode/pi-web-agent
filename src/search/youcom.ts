import { createJsonSearchProvider, normalizeResultsArray } from './json-provider.js';

const YOUCOM_SEARCH_URL = 'https://api.you.com/v1/agents/search';

export function createYouComSearchTool({ apiKey, fetchImpl = fetch }: { apiKey?: string; fetchImpl?: typeof fetch }) {
  return createJsonSearchProvider({
    name: 'youcom',
    label: 'You.com',
    apiKey,
    missingKeyMessage: 'You.com search requires YDC_API_KEY.',
    fetchImpl,
    request: (query) => ({
      url: YOUCOM_SEARCH_URL,
      init: {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey ?? '' },
        body: JSON.stringify({ query, max_results: 10 })
      }
    }),
    normalize: (json) => normalizeResultsArray(json, (body) => body.results, 'snippet')
  });
}
