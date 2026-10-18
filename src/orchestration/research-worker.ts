import { throwIfAborted } from '../abort.js';
import { failureOf, isTerminalFailure } from '../backends/failure.js';
import type { Attempt, ResearchFetchInput, SearchInput, WebFetchResponse, WebSearchResponse } from '../types.js';
import { selectCandidates } from './candidate-selector.js';
import { userFixableSearchFailures } from '../backends/fallback-policy.js';
import { classifySourceProfile } from './source-profile.js';
import { selectRelevantExcerpt } from '../extract/section-selector.js';
import { selectEvidencePassages } from './evidence-passages.js';
import { isBotCheckContent } from '../extract/bot-check.js';
import type { ResearchRunBudget } from './run-budget.js';
import type { ResearchProgress } from './progress.js';
import type { PresentationStatsCollector } from './presentation-stats.js';
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

function isReaderMethod(method: string): boolean {
  return method === 'github' || method === 'pdf' || method === 'youtube';
}

function evidenceFromFetch(fetched: WebFetchResponse, fallbackTitle: string, query: string) {
  const content = fetched.content;
  if (fetched.status !== 'ok' || !content) return null;
  if (isBotCheckContent({ title: content.title, text: content.text, botCheck: content.botCheck })) return null;
  if (!content.text.trim()) return null;

  // Reader extraction keeps its full text while source authority comes from the URL.
  if (isReaderMethod(fetched.metadata.method)) {
    return {
      title: content.title ?? fallbackTitle,
      url: fetched.url,
      sourceKind: classifySource(fetched.url),
      method: fetched.metadata.method,
      summary: content.text,
      supports: [content.text],
      ...(content.sectionAnchor ? { sectionAnchor: content.sectionAnchor } : {}),
      ...(fetched.metadata.cacheHit === false ? { retrievedAt: new Date().toISOString() } : {}),
      truncated: fetched.metadata.truncated ?? false
      , ...(fetched.metadata.partialComments ? { partialComments: true } : {})
    } satisfies ResearchEvidence;
  }

  const sourceKind = classifySource(fetched.url);
  if (sourceKind === 'package-page') {
    return null;
  }

  const passages = selectEvidencePassages(content.text, query);
  return {
    title: content.title ?? fallbackTitle,
    url: fetched.url,
    sourceKind,
    method: fetched.metadata.method,
    summary: selectRelevantExcerpt(content.text, query, 180),
    supports: passages.excerpts,
    ...(content.sectionAnchor ? { sectionAnchor: content.sectionAnchor } : {}),
    ...(fetched.metadata.cacheHit === false ? { retrievedAt: new Date().toISOString() } : {}),
    truncated: (fetched.metadata.truncated ?? false) || passages.truncated
    , ...(fetched.metadata.partialComments ? { partialComments: true } : {})
  } satisfies ResearchEvidence;
}

function lowValueOutcomeFromFetch(fetched: WebFetchResponse): ResearchLowValueOutcome | null {
  if (fetched.status !== 'ok' || !fetched.content) return null;

  if (isBotCheckContent({ title: fetched.content.title, text: fetched.content.text, botCheck: fetched.content.botCheck })) {
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
  search: (input: SearchInput) => Promise<WebSearchResponse>;
  fetchPage: (input: ResearchFetchInput) => Promise<WebFetchResponse>;
}) {
  return {
    async run({
      query,
      maxSearchRounds,
      maxFetches,
      signal,
      budget,
      onProgress,
      onPartial,
      presentationStats
    }: {
      query: string;
      maxSearchRounds: number;
      maxFetches: number;
      signal?: AbortSignal;
      budget?: ResearchRunBudget;
      onProgress?: (event: ResearchProgress) => void;
      onPartial?: (result: ResearchWorkerResult) => void;
      presentationStats?: PresentationStatsCollector;
    }): Promise<ResearchWorkerResult> {
      const activeSignal = budget?.signal ?? signal;
      const searchQueries = [query];
      const evidence: ResearchEvidence[] = [];
      const gaps: ResearchGap[] = [];
      const lowValueOutcomes: ResearchLowValueOutcome[] = [];
      let suggestedHeadlessUrl: string | undefined;
      let exhaustedBudget = false;
      const emit = (phase: ResearchProgress['phase'], state?: ResearchProgress['state'], target?: string) => {
        if (!onProgress) return;
        const { searches, fetches, headless } = budget?.snapshot() ?? { searches: 0, fetches: 0, headless: 0 };
        const stats = presentationStats?.snapshot();
        try { onProgress({ phase, ...(state ? { state } : {}), ...(target ? { target } : {}), searches, fetches, headless, ...(stats ? { pagesRead: stats.pagesRead, failedReads: stats.failedReads } : {}) }); } catch { /* Progress is observational. */ }
      };

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

      throwIfAborted(activeSignal);
      if (budget && !budget.claimSearch()) {
        return { searchQueries: [], evidence, gaps, lowValueOutcomes, exhaustedBudget: true };
      }
      presentationStats?.recordSearch(query);
      emit('search', 'started', query);
      let searchResult: WebSearchResponse;
      try {
        const searchWork = search({ query, signal: activeSignal });
        searchResult = budget ? await budget.wait(searchWork) : await searchWork;
      } finally {
        emit('search', 'settled', query);
      }
      throwIfAborted(activeSignal);
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
        const unavailable = userFixableSearchFailures(searchResult);
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
          searchAttempts,
          ...(unavailable.entries.length ? { searchUnavailable: unavailable.entries, searchUnavailableOnly: unavailable.exclusive } : {})
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
        seenUrls: budget?.visitedUrls ?? new Set(evidence.map((item) => item.url)),
        maxCandidates: maxFetches
      });

      const outcomes: Array<WebFetchResponse | Error | undefined> = new Array(candidates.length);
      const parsedEvidenceByCandidate = new Map<number, ResearchEvidence | null>();
      const collectOutcomes = (): ResearchWorkerResult => {
        const completedEvidence: ResearchEvidence[] = [];
        const completedGaps: ResearchGap[] = [];
        const completedLowValueOutcomes: ResearchLowValueOutcome[] = [];
        const fetchAttempts: Attempt[] = [];
        let completedHeadlessUrl: string | undefined;
        for (const [index, candidate] of candidates.entries()) {
          const fetched = outcomes[index];
          if (!fetched) continue;
          if (fetched instanceof Error) {
            completedGaps.push({ kind: 'fetch-failed', message: `Fetch failed for ${candidate.url}: ${fetched.message}` });
            continue;
          }
          if (fetched.metadata.attempts) fetchAttempts.push(...fetched.metadata.attempts);

          if (fetched.status === 'ok') {
            if (!parsedEvidenceByCandidate.has(index)) {
              parsedEvidenceByCandidate.set(index, evidenceFromFetch(fetched, candidate.title, query) ?? null);
            }
            const parsedEvidence = parsedEvidenceByCandidate.get(index);
            if (parsedEvidence) {
              completedEvidence.push(parsedEvidence);
              continue;
            }
            const lowValueOutcome = lowValueOutcomeFromFetch(fetched);
            if (lowValueOutcome) completedLowValueOutcomes.push(lowValueOutcome);
            continue;
          }

          if (isTerminalFailure(failureOf(fetched))) {
            completedGaps.push({ kind: 'fetch-failed', message: fetched.error?.message ?? `Fetch failed for ${candidate.url}` });
            continue;
          }
          if (fetched.status === 'needs_headless') {
            completedHeadlessUrl ??= fetched.url;
            completedGaps.push({ kind: 'fetch-failed', message: `HTTP fetch was weak for ${fetched.url}` });
            continue;
          }
          completedGaps.push({ kind: 'fetch-failed', message: fetched.error?.message ?? `Fetch failed for ${candidate.url}` });
        }
        return {
          searchQueries,
          evidence: completedEvidence,
          gaps: completedGaps,
          lowValueOutcomes: completedLowValueOutcomes,
          suggestedHeadlessUrl: completedHeadlessUrl,
          exhaustedBudget,
          fanoutProviders,
          fanoutSkipped,
          searchCoveragePartial,
          searchAttempts,
          fetchAttempts
        };
      };
      const started = new Set<number>();
      const activeHosts = new Set<string>();
      const inFlight = new Map<number, Promise<void>>();
      const host = (url: string) => {
        try { return new URL(url).hostname.toLowerCase(); } catch { return url; }
      };
      const startAvailable = () => {
        while (inFlight.size < 3) {
          const index = candidates.findIndex((candidate, position) => !started.has(position) && !activeHosts.has(host(candidate.url)));
          if (index < 0) break;
          const candidate = candidates[index];
          const hostname = host(candidate.url);
          started.add(index);
          if (budget && !budget.claimFetch(candidate.url)) {
            if (budget.snapshot().limitReason === 'fetch-limit') exhaustedBudget = true;
            continue;
          }
          emit('fetch', 'started', candidate.url);
          activeHosts.add(hostname);
          const request = (async () => {
            try {
              throwIfAborted(activeSignal);
              const fetchWork = fetchPage({ url: candidate.url, query, signal: activeSignal });
              outcomes[index] = budget ? await budget.wait(fetchWork) : await fetchWork;
              presentationStats?.recordRead(outcomes[index], undefined, candidate.url);
            } catch (error) {
              if (!activeSignal?.aborted) presentationStats?.recordFailure(candidate.url);
              throwIfAborted(activeSignal);
              outcomes[index] = error instanceof Error ? error : new Error(String(error));
            } finally {
              emit('fetch', 'settled', candidate.url);
            }
          })().finally(() => {
            activeHosts.delete(hostname);
            inFlight.delete(index);
            if (outcomes[index] && onPartial) {
              try { onPartial(collectOutcomes()); } catch { /* Partial evidence is observational. */ }
            }
          });
          request.catch(() => undefined);
          inFlight.set(index, request);
        }
      };
      startAvailable();
      while (inFlight.size > 0) {
        await Promise.race(inFlight.values());
        throwIfAborted(activeSignal);
        startAvailable();
      }

      throwIfAborted(activeSignal);
      return collectOutcomes();
    }
  };
}
