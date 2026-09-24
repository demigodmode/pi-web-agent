import { createJsonSearchProvider, type Normalized } from './json-provider.js';

export const YOUCOM_SEARCH_URL = 'https://ydc-index.io/v1/search';

function normalizeResult(item: unknown, snippet: string) {
  if (!item || typeof item !== 'object') return [];
  const result = item as { title?: unknown; url?: unknown; description?: unknown };
  return typeof result.title === 'string' && typeof result.url === 'string'
    ? [{ title: result.title, url: result.url, snippet: typeof result.description === 'string' ? result.description : snippet }]
    : [];
}

export function normalizeYouComResults(json: unknown): Normalized | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const response = json as { results?: unknown };
  if (!response.results || typeof response.results !== 'object' || Array.isArray(response.results)) return undefined;

  const sections = response.results as { web?: unknown; news?: unknown };
  if (sections.web === undefined && sections.news === undefined) return undefined;
  if (sections.web !== undefined && !Array.isArray(sections.web)) return undefined;
  if (sections.news !== undefined && !Array.isArray(sections.news)) return undefined;

  const web = sections.web ?? [];
  const news = sections.news ?? [];
  return {
    rawCount: web.length + news.length,
    results: [
      ...web.flatMap((item) => {
        const snippets = item && typeof item === 'object' ? (item as { snippets?: unknown }).snippets : undefined;
        const snippet = Array.isArray(snippets) ? snippets.find((value): value is string => typeof value === 'string') ?? '' : '';
        return normalizeResult(item, snippet);
      }),
      ...news.flatMap((item) => normalizeResult(item, ''))
    ]
  };
}

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
        body: JSON.stringify({ query, count: 10 })
      }
    }),
    normalize: normalizeYouComResults
  });
}
