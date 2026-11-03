import { createJsonSearchProvider } from './json-provider.js';

const KEENABLE_SEARCH_URL = 'https://api.keenable.ai/v1/search';
const SNIPPET_MAX_CHARS = 500;

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
          'X-API-Key': apiKey ?? '',
          'X-Keenable-Title': 'pi-web-agent'
        },
        body: JSON.stringify({ query, max_results: 10 })
      }
    }),
    normalize: (json) => {
      if (!json || typeof json !== 'object') return undefined;
      const raw = (json as { results?: unknown }).results;
      if (!Array.isArray(raw)) return undefined;
      return {
        rawCount: raw.length,
        results: raw.flatMap((item: any) => {
          if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') return [];
          const description = typeof item.description === 'string' ? item.description.trim() : '';
          const snippet = typeof item.snippet === 'string' ? item.snippet.trim().slice(0, SNIPPET_MAX_CHARS) : '';
          return [{ title: item.title, url: item.url, snippet: description || snippet }];
        })
      };
    }
  });
}
