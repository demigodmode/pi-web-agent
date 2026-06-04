import type { SearchResult } from '../types.js';
import { classifySourceProfile } from './source-profile.js';

function wantsDiscussionSources(query = '') {
  return /reddit|forum|forums|discussion|thread|comments|community|user experience|people recommend/i.test(query);
}

function candidateScore(result: SearchResult, query?: string) {
  const url = result.url.toLowerCase();
  const profile = classifySourceProfile(result.url);
  const wantsThreads = wantsDiscussionSources(query);

  if (profile.kind === 'official-docs') return 0;
  if (profile.kind === 'official-api') return 1;

  if (wantsThreads) {
    if (profile.kind === 'forum-thread') return 2;
    if (profile.kind === 'issue-thread') return 3;
    if (url.includes('github.com/')) return 4;
    if (profile.kind === 'package-page') return 6;
    return 5;
  }

  if (profile.kind === 'issue-thread') return 2;
  if (url.includes('github.com/')) return 3;
  if (profile.kind === 'package-page') return 5;
  return 4;
}

export function selectCandidates({
  query,
  results,
  seenUrls,
  maxCandidates
}: {
  query?: string;
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
    .sort((left, right) => candidateScore(left, query) - candidateScore(right, query))
    .slice(0, maxCandidates);
}
