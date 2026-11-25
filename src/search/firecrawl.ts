import { createJsonSearchProvider, normalizeResultsArray } from './json-provider.js';

export const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v2/search';
const SNIPPET_MAX_LENGTH = 500;

export function createFirecrawlSearchTool({ apiKey, fetchImpl = fetch }: { apiKey?: string; fetchImpl?: typeof fetch }) {
  return createJsonSearchProvider({
    name: 'firecrawl',
    label: 'Firecrawl',
    apiKey,
    missingKeyMessage: 'Firecrawl search requires PI_WEB_AGENT_FIRECRAWL_API_KEY.',
    fetchImpl,
    request: (query) => ({
      url: FIRECRAWL_SEARCH_URL,
      init: {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey ?? ''}`
        },
        body: JSON.stringify({ query, limit: 10, origin: 'pi-web-agent' })
      }
    }),
    normalize: (json) => {
      const normalized = normalizeResultsArray(json, (body) => body.data?.web, 'description');
      return normalized && {
        ...normalized,
        results: normalized.results.map((result) => ({ ...result, snippet: result.snippet.slice(0, SNIPPET_MAX_LENGTH) }))
      };
    }
  });
}
