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

export async function fetchDuckDuckGoHtml(query: string): Promise<string> {
  const response = await fetch(buildSearchUrl(query));
  if (!response.ok) {
    throw new Error(`DuckDuckGo request failed with ${response.status}`);
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
