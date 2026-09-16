import type { SearxngOptions } from '../backends/config.js';
import { createJsonSearchProvider, normalizeResultsArray } from './json-provider.js';

function buildSearchUrl(baseUrl: string, query: string, options: SearxngOptions = {}) {
  const url = new URL('/search', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  if (options.categories?.length) url.searchParams.set('categories', options.categories.join(','));
  if (options.language) url.searchParams.set('language', options.language);
  if (options.safesearch !== undefined) url.searchParams.set('safesearch', String(options.safesearch));
  return url.toString();
}

export function createSearxngSearchTool({
  baseUrl,
  options,
  fetchImpl = fetch
}: {
  baseUrl: string;
  options?: SearxngOptions;
  fetchImpl?: typeof fetch;
}) {
  return createJsonSearchProvider({
    name: 'searxng',
    label: 'SearXNG',
    requiresKey: false,
    fetchImpl,
    request: (query) => ({ url: buildSearchUrl(baseUrl, query, options) }),
    normalize: (json) => normalizeResultsArray(json, (body) => body.results, 'content'),
    // Suspended upstream engines still answer 200; version-dependent field (UNVERIFIED everywhere).
    isDegradedEmpty: (json) => {
      const unresponsive = (json as { unresponsive_engines?: unknown }).unresponsive_engines;
      if (Array.isArray(unresponsive)) return unresponsive.length > 0;
      return !!unresponsive && typeof unresponsive === 'object' && Object.keys(unresponsive).length > 0;
    }
  });
}
