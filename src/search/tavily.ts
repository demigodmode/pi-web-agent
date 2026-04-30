import { tavily } from '@tavily/core';
import type { SearchResult } from '../types.js';

export async function fetchTavilyResults(
  query: string,
  apiKey?: string
): Promise<SearchResult[]> {
  const key = apiKey ?? process.env.TAVILY_API_KEY;
  if (!key) {
    throw new Error('TAVILY_API_KEY is not set.');
  }

  const client = tavily({ apiKey: key });
  const response = await client.search(query, {
    maxResults: 10,
    searchDepth: 'basic'
  });

  return response.results.map((r: { title: string; url: string; content: string }) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? ''
  }));
}
