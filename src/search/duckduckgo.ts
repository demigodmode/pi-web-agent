import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.js';

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

export function parseDuckDuckGoResults(html: string): SearchResult[] {
  const $ = cheerio.load(html);

  return $('.result')
    .map((_, element) => {
      const title = $(element).find('.result__a').first().text().trim();
      const url = $(element).find('.result__a').first().attr('href')?.trim() ?? '';
      const snippet = $(element).find('.result__snippet').first().text().trim();

      return title && url ? { title, url, snippet } : null;
    })
    .get()
    .filter((value): value is SearchResult => value !== null);
}
