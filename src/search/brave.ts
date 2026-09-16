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
    // A search response (`type: 'search'`) with no `web` block, or a `web` block with no `results`,
    // is Brave's valid empty response. Anything else without `web` (an error-shaped or partial 200)
    // is not trusted as empty.
    normalize: (json) =>
      normalizeResultsArray(
        json,
        (body) => {
          if (body.web === undefined) return body.type === 'search' ? [] : undefined;
          if (!body.web || typeof body.web !== 'object') return undefined;
          return body.web.results === undefined ? [] : body.web.results;
        },
        'description'
      )
  });
}
