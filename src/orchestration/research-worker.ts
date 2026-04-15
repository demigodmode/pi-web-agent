import type { WebFetchResponse, WebSearchResponse } from '../types.js';
import type {
  ResearchEvidence,
  ResearchGap,
  ResearchLowValueOutcome,
  ResearchSourceKind,
  ResearchWorkerResult
} from './research-types.js';

function classifySource(url: string): ResearchSourceKind {
  if (url.includes('playwright.dev/docs/api')) return 'official-api';
  if (url.includes('playwright.dev/docs')) return 'official-docs';
  if (url.includes('learn.microsoft.com')) return 'official-docs';
  if (url.includes('github.com/') && url.includes('/issues/')) return 'issue-thread';
  if (url.includes('npmjs.com/package/')) return 'package-page';
  return 'community';
}

function summarizeText(text: string, maxLength = 180): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function evidenceFromFetch(fetched: WebFetchResponse, fallbackTitle: string) {
  const content = fetched.content;
  if (fetched.status !== 'ok' || !content) return null;

  const sourceKind = classifySource(fetched.url);
  if (sourceKind === 'package-page') {
    return null;
  }

  return {
    title: content.title ?? fallbackTitle,
    url: fetched.url,
    sourceKind,
    method: fetched.metadata.method,
    summary: summarizeText(content.text),
    supports: [summarizeText(content.text, 120)]
  } satisfies ResearchEvidence;
}

function lowValueOutcomeFromFetch(fetched: WebFetchResponse): ResearchLowValueOutcome | null {
  if (fetched.status !== 'ok' || !fetched.content) return null;
  if (classifySource(fetched.url) !== 'package-page') return null;

  return {
    kind: 'low-value-page',
    url: fetched.url,
    message: 'Fetched page did not add strong research evidence.'
  };
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
      const lowValueOutcomes: ResearchLowValueOutcome[] = [];
      let suggestedHeadlessUrl: string | undefined;

      if (maxSearchRounds <= 0 || maxFetches <= 0) {
        return {
          searchQueries: [],
          evidence,
          gaps: [{ kind: 'needs-more-evidence', message: 'Research worker budget was zero.' }],
          lowValueOutcomes,
          suggestedHeadlessUrl,
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
          lowValueOutcomes,
          suggestedHeadlessUrl,
          exhaustedBudget: false
        };
      }

      if (searchResult.results.length === 0) {
        return {
          searchQueries,
          evidence,
          gaps,
          lowValueOutcomes: [
            {
              kind: 'empty-search',
              message: 'Search returned no results for this pass.'
            }
          ],
          suggestedHeadlessUrl,
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
            continue;
          }

          const lowValueOutcome = lowValueOutcomeFromFetch(fetched);
          if (lowValueOutcome) {
            lowValueOutcomes.push(lowValueOutcome);
          }
          continue;
        }

        if (fetched.status === 'needs_headless') {
          if (!suggestedHeadlessUrl) {
            suggestedHeadlessUrl = fetched.url;
          }
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
        lowValueOutcomes,
        suggestedHeadlessUrl,
        exhaustedBudget: false
      };
    }
  };
}
