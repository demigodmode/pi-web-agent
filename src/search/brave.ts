import { createJsonSearchProvider, normalizeResultsArray } from './json-provider.js';

const BRAVE_WEB_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

export function createBraveSearchTool({ apiKey, fetchImpl = fetch }: { apiKey?: string; fetchImpl?: typeof fetch }) {
  return createJsonSearchProvider({
    name: 'brave',
    label: 'Brave',
    apiKey,
    missingKeyMessage: 'Brave search requires PI_WEB_AGENT_BRAVE_API_KEY.',
    fetchImpl,
    request: (query) => {
      const url = new URL(BRAVE_WEB_SEARCH_URL);
      url.searchParams.set('q', query);
      return { url: url.toString(), init: { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey ?? '' } } };
    },
    // A 200 with no `web` block, or `web.results` missing, is Brave's valid empty response.
    normalize: (json) =>
      normalizeResultsArray(json, (body) => (body.web === undefined ? [] : (body.web?.results ?? [])), 'description')
  });
}
