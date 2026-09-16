import { createJsonSearchProvider, normalizeResultsArray } from './json-provider.js';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

export function createTavilySearchTool({
  apiKey,
  keyless = false,
  fetchImpl = fetch
}: {
  apiKey?: string;
  keyless?: boolean;
  fetchImpl?: typeof fetch;
}) {
  const keyed = Boolean(apiKey?.trim());
  return createJsonSearchProvider({
    name: 'tavily',
    label: 'Tavily',
    apiKey,
    requiresKey: !keyless,
    missingKeyMessage: 'Tavily search requires TAVILY_API_KEY.',
    fetchImpl,
    request: (query) => ({
      url: TAVILY_SEARCH_URL,
      init: {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(keyed ? { Authorization: `Bearer ${apiKey}` } : { 'X-Tavily-Access-Mode': 'keyless' })
        },
        body: JSON.stringify({ query, max_results: 10 })
      }
    }),
    normalize: (json) => normalizeResultsArray(json, (body) => body.results, 'content')
  });
}
