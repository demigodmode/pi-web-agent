import { failureOf, isTerminalFailure } from '../backends/failure.js';
import type { Attempt, ResearchFetchInput, WebFetchResponse, WebSearchResponse } from '../types.js';
import { selectCandidates } from './candidate-selector.js';
import { classifySourceProfile } from './source-profile.js';
import type {
  ResearchEvidence,
  ResearchGap,
  ResearchLowValueOutcome,
  ResearchSourceKind,
  ResearchWorkerResult
} from './research-types.js';

function classifySource(url: string): ResearchSourceKind {
  return classifySourceProfile(url).sourceKind;
}

function summarizeText(text: string, maxLength = 180): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isReaderMethod(method: string): boolean {
  return method === 'github' || method === 'pdf' || method === 'youtube';
}

function isBotCheckContent({ title = '', text }: { title?: string; text: string }) {
  return /performing security verification|security service|verify you are not a bot|just a moment|checking your browser/i.test(
    `${title}\n${text}`
  );
}

function evidenceFromFetch(fetched: WebFetchResponse, fallbackTitle: string) {
  const content = fetched.content;
  if (fetched.status !== 'ok' || !content) return null;
  if (isBotCheckContent({ title: content.title, text: content.text })) return null;

  // A successful reader read with usable text is primary content, exempt from the
  // package-page filter below.
  if (isReaderMethod(fetched.metadata.method) && content.text.trim()) {
    return {
      title: content.title ?? fallbackTitle,
      url: fetched.url,
      sourceKind: 'primary-content',
      method: fetched.metadata.method,
      summary: content.text,
      supports: [content.text]
    } satisfies ResearchEvidence;
  }

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

  if (isBotCheckContent({ title: fetched.content.title, text: fetched.content.text })) {
    return {
      kind: 'bot-check',
      url: fetched.url,
      message: 'Fetched page showed a bot-check or security verification page.'
    };
  }

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
  fetchPage: (input: ResearchFetchInput) => Promise<WebFetchResponse>;
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
      const searchCoveragePartial = searchResult.metadata.coverage?.partial === true;
      const searchAttempts = searchResult.metadata.attempts;
      if (isTerminalFailure(failureOf(searchResult))) {
        return {
          searchQueries,
          evidence,
          gaps: [],
          lowValueOutcomes,
          exhaustedBudget: false,
          searchAttempts,
          terminalFailure: {
            code: searchResult.error?.code ?? 'SEARCH_FAILED',
            message: `${searchResult.error?.message ?? 'Search failed.'} (${searchResult.error?.failure?.kind})`
          }
        };
      }
      const fanoutProviders = searchResult.metadata.fanout?.providers;
      const fanoutSkipped = searchResult.metadata.fanout?.skipped;
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
          exhaustedBudget: false,
          fanoutProviders,
          fanoutSkipped,
          searchCoveragePartial,
          searchAttempts
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
          exhaustedBudget: false,
          fanoutProviders,
          fanoutSkipped,
          searchCoveragePartial,
          searchAttempts
        };
      }

      const candidates = selectCandidates({
        query,
        results: searchResult.results,
        seenUrls: new Set(evidence.map((item) => item.url)),
        maxCandidates: maxFetches
      });

      const fetchAttempts: Attempt[] = [];
      for (const candidate of candidates) {
        const fetched = await fetchPage({ url: candidate.url, query });
        if (fetched.metadata.attempts) fetchAttempts.push(...fetched.metadata.attempts);

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

        // guard_refused and friends are final; never hand them to headless.
        if (isTerminalFailure(failureOf(fetched))) {
          gaps.push({
            kind: 'fetch-failed',
            message: fetched.error?.message ?? `Fetch failed for ${candidate.url}`
          });
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
        exhaustedBudget: false,
        fanoutProviders,
        fanoutSkipped,
        searchCoveragePartial,
        searchAttempts,
        fetchAttempts
      };
    }
  };
}
