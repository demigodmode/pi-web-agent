import { createJsonSearchProvider, normalizeResultsArray } from './json-provider.js';

const EXA_SEARCH_URL = 'https://api.exa.ai/search';

export function createExaSearchTool({ apiKey, fetchImpl = fetch }: { apiKey?: string; fetchImpl?: typeof fetch }) {
  return createJsonSearchProvider({
    name: 'exa',
    label: 'Exa',
    apiKey,
    missingKeyMessage: 'Exa search requires EXA_API_KEY.',
    fetchImpl,
    request: (query) => ({
      url: EXA_SEARCH_URL,
      init: {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': apiKey ?? '' },
        body: JSON.stringify({ query, numResults: 10 })
      }
    }),
    normalize: (json) => normalizeResultsArray(json, (body) => body.results, 'text')
  });
}
