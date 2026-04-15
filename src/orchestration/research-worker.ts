import type { WebFetchResponse, WebSearchResponse } from '../types.js';
import type {
  ResearchEvidence,
  ResearchGap,
  ResearchSourceKind,
  ResearchWorkerResult
} from './research-types.js';

function classifySource(url: string): ResearchSourceKind {
  if (url.includes('playwright.dev/docs/api')) return 'official-api';
  if (url.includes('playwright.dev/docs')) return 'official-docs';
  if (url.includes('learn.microsoft.com')) return 'official-docs';
  if (url.includes('github.com/') && url.includes('/issues/')) return 'issue-thread';
  return 'community';
}

function summarizeText(text: string, maxLength = 180): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function evidenceFromFetch(fetched: Extract<WebFetchResponse, { status: 'ok' }>, fallbackTitle: string) {
  const content = fetched.content;
  if (!content) return null;

  const summary = summarizeText(content.text);
  const evidence: ResearchEvidence = {
    title: content.title ?? fallbackTitle,
    url: fetched.url,
    sourceKind: classifySource(fetched.url),
    method: fetched.metadata.method,
    summary,
    supports: [summarizeText(content.text, 120)]
  };

  return evidence;
}

export function createResearchWorker({
  search,
  fetchPage
}: {
  search: (input: { query: string }) => Promise<WebSearchResponse>;
  fetchPage: (input: { url: string }) => Promise<WebFetchResponse>;
}) {
  return {
    async run({
      query,
      maxSearchRounds,
      maxFetches
    }: {
      query: string;
      maxSearchRounds: number;
      maxFetches: number;
    }): Promise<ResearchWorkerResult> {
      const searchQueries = [query];
      const evidence: ResearchEvidence[] = [];
      const gaps: ResearchGap[] = [];
      const suggestedHeadlessUrls: string[] = [];

      if (maxSearchRounds <= 0 || maxFetches <= 0) {
        return {
          searchQueries: [],
          evidence,
          gaps: [{ kind: 'needs-more-evidence', message: 'Research worker budget was zero.' }],
          suggestedHeadlessUrls,
          exhaustedBudget: true
        };
      }

      const searchResult = await search({ query });
      if (searchResult.status !== 'ok') {
        return {
          searchQueries,
          evidence,
          gaps: [
            {
              kind: 'fetch-failed',
              message: searchResult.error?.message ?? 'Search failed during research worker pass.'
            }
          ],
          suggestedHeadlessUrls,
          exhaustedBudget: false
        };
      }

      const candidates = searchResult.results.slice(0, maxFetches);

      for (const candidate of candidates) {
        const fetched = await fetchPage({ url: candidate.url });

        if (fetched.status === 'ok') {
          const parsedEvidence = evidenceFromFetch(fetched, candidate.title);
          if (parsedEvidence) {
            evidence.push(parsedEvidence);
          }
          continue;
        }

        if (fetched.status === 'needs_headless') {
          suggestedHeadlessUrls.push(fetched.url);
          gaps.push({ kind: 'fetch-failed', message: `HTTP fetch was weak for ${fetched.url}` });
          continue;
        }

        gaps.push({
          kind: 'fetch-failed',
          message: fetched.error?.message ?? `Fetch failed for ${candidate.url}`
        });
      }

      return {
        searchQueries,
        evidence,
        gaps,
        suggestedHeadlessUrls,
        exhaustedBudget: false
      };
    }
  };
}
