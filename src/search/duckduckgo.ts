import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.js';

export type ParsedDuckDuckGoResults = {
  results: SearchResult[];
  noResults: boolean;
  hasResultContainers: boolean;
};

function normalizeDuckDuckGoUrl(rawUrl: string): string {
  try {
    const absolute = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const parsed = new URL(absolute);
    const isDuckDuckGoRedirect = parsed.hostname === 'duckduckgo.com' && parsed.pathname === '/l/';

    if (!isDuckDuckGoRedirect) {
      return rawUrl;
    }

    const target = parsed.searchParams.get('uddg');
    if (!target) {
      return rawUrl;
    }

    return decodeURIComponent(target);
  } catch {
    return rawUrl;
  }
}

export function buildSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query });
  return `https://html.duckduckgo.com/html/?${params.toString()}`;
}

export const DUCKDUCKGO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
} as const;

export class DuckDuckGoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Headers
  ) {
    super(`DuckDuckGo request failed with ${status}`);
    this.name = 'DuckDuckGoHttpError';
  }
}

/** One request. Retries belong to the fallback policy (#55), which only retries transient failures. */
export async function fetchDuckDuckGoHtml(
  query: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}
): Promise<string> {
  const response = await fetchImpl(buildSearchUrl(query), { headers: { ...DUCKDUCKGO_HEADERS } });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new DuckDuckGoHttpError(response.status, response.headers);
  }
  return response.text();
}

export function parseDuckDuckGoResults(html: string): ParsedDuckDuckGoResults {
  const $ = cheerio.load(html);
  const resultContainers = $('.result');

  const results = resultContainers
    .map((_, element) => {
      const title = $(element).find('.result__a').first().text().trim();
      const url = normalizeDuckDuckGoUrl(
        $(element).find('.result__a').first().attr('href')?.trim() ?? ''
      );
      const snippet = $(element).find('.result__snippet').first().text().trim();

      return title && url ? { title, url, snippet } : null;
    })
    .get()
    .filter((value): value is SearchResult => value !== null);

  const text = $.text().toLowerCase();
  const noResults =
    text.includes('no results found') ||
    text.includes('no more results') ||
    text.includes('did not match any documents');

  return {
    results,
    noResults,
    hasResultContainers: resultContainers.length > 0
  };
}
