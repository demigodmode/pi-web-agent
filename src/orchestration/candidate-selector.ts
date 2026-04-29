import type { SearchResult } from '../types.js';

function candidateScore(result: SearchResult) {
  const url = result.url.toLowerCase();
  if (url.includes('playwright.dev/docs') || url.includes('vitest.dev/guide') || url.includes('learn.microsoft.com')) return 0;
  if (url.includes('github.com/') && (url.includes('/issues/') || url.includes('/discussions/'))) return 1;
  if (url.includes('github.com/')) return 2;
  if (url.includes('npmjs.com/package/')) return 4;
  return 3;
}

export function selectCandidates({
  results,
  seenUrls,
  maxCandidates
}: {
  results: SearchResult[];
  seenUrls: Set<string>;
  maxCandidates: number;
}) {
  const deduped = new Map<string, SearchResult>();
  for (const result of results) {
    if (seenUrls.has(result.url)) continue;
    if (!deduped.has(result.url)) deduped.set(result.url, result);
  }

  return [...deduped.values()]
    .sort((left, right) => candidateScore(left) - candidateScore(right))
    .slice(0, maxCandidates);
}
