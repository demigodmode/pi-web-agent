import type { Attempt, ResearchFetchInput, SearchProviderName, SearchUnavailable, WebFetchHeadlessResponse, WebFetchResponse } from '../types.js';
import { throwIfAborted } from '../abort.js';
import { failureOf, isTerminalFailure } from '../backends/failure.js';
import { rankEvidence } from './evidence-ranker.js';
import { planSearchQueries } from './query-planner.js';
import { classifySourceProfile } from './source-profile.js';
import { extractDirectUrls } from './direct-url.js';
import type {
  ResearchEvidence,
  ResearchGap,
  ResearchLowValueOutcome,
  ResearchOrchestratorDecision,
  RequiredSourceFailure,
  ResearchWorkerResult
} from './research-types.js';
import { decideNextResearchStep } from './stop-decider.js';
import { analyzeEvidenceQuality, type EvidenceCaveatReason } from './evidence-quality.js';
import { selectRelevantExcerpt } from '../extract/section-selector.js';
import { selectEvidencePassages } from './evidence-passages.js';
import { isBotCheckContent } from '../extract/bot-check.js';
import { REPO_MAX_TYPED_REPOS } from '../repo/limits.js';
import type { RepoResearchInput, RepoResearchResult } from '../repo/repo-research.js';
import { parseRepoUrl } from '../repo/repo-url.js';
import { classifyResearchIntent, missingComparisonTargets } from './research-intent.js';
import { createResearchRunBudget, type ResearchBudgetReason, type ResearchBudgetSnapshot } from './run-budget.js';
import type { ResearchProgress } from './progress.js';
import { createPresentationStats, type PresentationStats } from './presentation-stats.js';

const DEFAULT_MAX_PASSES = 3;
const DEFAULT_MAX_FETCHES_PER_PASS = 4;
const DEFAULT_MAX_HEADLESS_ATTEMPTS = 2;

function classifyEvidenceUrl(url: string): ResearchEvidence['sourceKind'] {
  return classifySourceProfile(url).sourceKind;
}

function isReaderMethod(method: string): boolean {
  return method === 'github' || method === 'pdf' || method === 'youtube';
}

function isOpinionQuestion(query: string): boolean {
  return /\b(?:what do (?:users|people|developers) (?:think|feel|say)(?: about)?|(?:users?|people|developers?|community)[’']?\s+(?:opinions?|experiences?|reviews?|feedback)(?:\s+(?:with|of|about|using))?)\b/i.test(query);
}

function evidenceFromFetch(result: WebFetchResponse, query: string, { trustedContent = false, requestedUrl }: { trustedContent?: boolean; requestedUrl?: string } = {}): ResearchEvidence | null {
  if (result.status !== 'ok' || !result.content?.text.trim()) return null;
  if (!trustedContent && isBotCheckContent({ title: result.content.title, text: result.content.text, botCheck: result.content.botCheck })) return null;

  if (isReaderMethod(result.metadata.method)) {
    return {
      title: result.content.title ?? result.url,
      url: result.url,
      ...(requestedUrl ? { requestedUrl } : {}),
      sourceKind: classifyEvidenceUrl(result.url),
      method: result.metadata.method,
      summary: result.content.text,
      supports: [result.content.text],
      ...(result.content.sectionAnchor ? { sectionAnchor: result.content.sectionAnchor } : {}),
      ...(result.metadata.cacheHit === false ? { retrievedAt: new Date().toISOString() } : {}),
      truncated: result.metadata.truncated ?? false
      , ...(result.metadata.partialComments ? { partialComments: true } : {})
    };
  }

  const passages = selectEvidencePassages(result.content.text, query);
  return {
    title: result.content.title ?? result.url,
    url: result.url,
    ...(requestedUrl ? { requestedUrl } : {}),
    sourceKind: classifyEvidenceUrl(result.url),
    method: result.metadata.method,
    summary: selectRelevantExcerpt(result.content.text, query, 180),
    supports: passages.excerpts,
    ...(result.content.sectionAnchor ? { sectionAnchor: result.content.sectionAnchor } : {}),
    ...(result.metadata.cacheHit === false ? { retrievedAt: new Date().toISOString() } : {}),
    truncated: (result.metadata.truncated ?? false) || passages.truncated
    , ...(result.metadata.partialComments ? { partialComments: true } : {})
  };
}

function evidenceFromHeadless(result: WebFetchHeadlessResponse, query: string, requestedUrl?: string): ResearchEvidence | null {
  if (result.status !== 'ok' || !result.content?.text.trim()) return null;
  if (isBotCheckContent({ title: result.content.title, text: result.content.text, botCheck: result.content.botCheck })) return null;

  const passages = selectEvidencePassages(result.content.text, query);
  return {
    title: result.content.title ?? result.url,
    url: result.url,
    ...(requestedUrl ? { requestedUrl } : {}),
    sourceKind: classifyEvidenceUrl(result.url),
    method: 'headless',
    summary: selectRelevantExcerpt(result.content.text, query, 180),
    supports: passages.excerpts,
    ...(result.content.sectionAnchor ? { sectionAnchor: result.content.sectionAnchor } : {}),
    ...(result.metadata.cacheHit === false ? { retrievedAt: new Date().toISOString() } : {}),
    truncated: (result.metadata.truncated ?? false) || passages.truncated
  };
}

function combinedWorkerPass({
  lastPass,
  previousQueries,
  allGaps,
  allLowValueOutcomes,
  exhaustedBudget
}: {
  lastPass?: ResearchWorkerResult;
  previousQueries: string[];
  allGaps: ResearchGap[];
  allLowValueOutcomes: ResearchLowValueOutcome[];
  exhaustedBudget: boolean;
}): ResearchWorkerResult {
  return {
    searchQueries: lastPass?.searchQueries ?? previousQueries,
    evidence: lastPass?.evidence ?? [],
    gaps: allGaps,
    lowValueOutcomes: allLowValueOutcomes,
    suggestedHeadlessUrl: lastPass?.suggestedHeadlessUrl,
    exhaustedBudget
  };
}

function directUnreadableMessage(url: string) {
  return classifySourceProfile(url).kind === 'forum-thread'
    ? `Thread source could not be read reliably: ${url}`
    : `Direct URL could not be read reliably: ${url}`;
}

function shouldRetryDirectWithHeadless(result: WebFetchResponse, evidence: ResearchEvidence | null) {
  if (result.status === 'needs_headless') return true;
  if (result.status !== 'ok' || evidence) return false;
  return classifySourceProfile(result.url).shouldPreferHeadlessWhenWeak;
}

function buildMetadata({
  executedQueries,
  allEvidence,
  allGaps,
  allLowValueOutcomes,
  headlessAttempts,
  exhaustedBudget,
  caveatReasons = [],
  missingComparisonTargets = [],
  fanoutProviders,
  fanoutSkipped,
  attempts,
  budgetReason,
  budget,
  presentationStats,
  requiredSourceFailures
}: {
  executedQueries: string[];
  allEvidence: ResearchEvidence[];
  allGaps: ResearchGap[];
  allLowValueOutcomes: ResearchLowValueOutcome[];
  headlessAttempts: number;
  exhaustedBudget: boolean;
  caveatReasons?: EvidenceCaveatReason[];
  missingComparisonTargets?: string[];
  fanoutProviders?: SearchProviderName[];
  fanoutSkipped?: SearchProviderName[];
  attempts?: Attempt[];
  budgetReason?: ResearchBudgetReason;
  budget?: ResearchBudgetSnapshot;
  presentationStats?: PresentationStats;
  requiredSourceFailures?: RequiredSourceFailure[];
}) {
  return {
    searchPasses: executedQueries.length,
    fetchedPages: allEvidence.length + allGaps.length + allLowValueOutcomes.length,
    headlessAttempts: budget?.headless ?? headlessAttempts,
    exhaustedBudget,
    caveatReasons,
    missingComparisonTargets,
    fanoutProviders,
    fanoutSkipped,
    budgetReason,
    budget,
    presentationStats,
    ...(requiredSourceFailures?.length ? { requiredSourceFailures } : {}),
    ...(attempts && attempts.length > 0 ? { attempts } : {})
  };
}

type ResearchOrchestratorResult = {
  decision: ResearchOrchestratorDecision;
  evidence: ResearchEvidence[];
  workerPass: ResearchWorkerResult;
  metadata: ReturnType<typeof buildMetadata>;
  terminalFailure?: { code: string; message: string };
  requiredSourceEvidence: ResearchEvidence[];
  requiredSourceFailures: RequiredSourceFailure[];
  searchUnavailable?: SearchUnavailable[];
};

function decisionForAnswer({
  action,
  query,
  ranked,
  exhaustedBudget
}: {
  action: 'answer' | 'answer-with-caveat';
  query: string;
  ranked: ResearchEvidence[];
  exhaustedBudget: boolean;
}): ResearchOrchestratorDecision {
  if (action === 'answer') {
    return {
      action: 'answer',
      rationale: 'Adaptive research gathered enough strong evidence.',
      approvedEvidence: ranked
    };
  }

  return {
    action: 'research-again',
    rationale: exhaustedBudget ? 'Research budget exhausted; answer with caveat.' : 'Evidence has quality caveats; answer with caveat.',
    followupQuery: query
  };
}

export function createResearchOrchestrator({
  worker,
  fetchDirect,
  headlessFetch,
  researchRepo
}: {
  worker: {
    run: (input: {
      query: string;
      maxSearchRounds: number;
      maxFetches: number;
      signal?: AbortSignal;
      budget?: import('./run-budget.js').ResearchRunBudget;
      onProgress?: (event: ResearchProgress) => void;
      onPartial?: (result: ResearchWorkerResult) => void;
      presentationStats?: ReturnType<typeof createPresentationStats>;
    }) => Promise<ResearchWorkerResult>;
  };
  fetchDirect?: (input: ResearchFetchInput) => Promise<WebFetchResponse>;
  headlessFetch: (input: ResearchFetchInput) => Promise<WebFetchHeadlessResponse>;
  /** Typed GitHub repo URLs (#72). Without it, they go through fetchDirect like any page. */
  researchRepo?: (input: RepoResearchInput) => Promise<RepoResearchResult>;
}) {
  const pending = new Set<Promise<unknown>>();
  const track = (promise: Promise<unknown>) => {
    pending.add(promise);
    void promise.finally(() => pending.delete(promise)).catch(() => undefined);
  };

  return {
    async run({ query, signal, onProgress }: { query: string; signal?: AbortSignal; onProgress?: (event: ResearchProgress) => void }): Promise<ResearchOrchestratorResult> {
      // Direct links are contractual inputs. Reserve their bounded work before
      // discretionary search gets a chance to spend the run budget.
      const typedUrls = extractDirectUrls(query);
      const budget = createResearchRunBudget({
        signal,
        track,
        maxFetches: 20 + Math.min(8, typedUrls.length),
        maxHeadless: 2 + Math.min(8, typedUrls.filter((url) => !parseRepoUrl(url)).length)
      });
      const presentationStats = createPresentationStats();
      const emit = (phase: ResearchProgress['phase'], state?: ResearchProgress['state'], target?: string, position?: ResearchProgress['position']) => {
        if (!onProgress) return;
        const { searches, fetches, headless } = budget.snapshot();
        const stats = presentationStats.snapshot();
        try { onProgress({ phase, ...(state ? { state } : {}), ...(target ? { target } : {}), ...(position ? { position } : {}), searches, fetches, headless, pagesRead: stats.pagesRead, failedReads: stats.failedReads }); } catch { /* Progress is observational. */ }
      };
      const intent = classifyResearchIntent(query);
      const opinionQuestion = isOpinionQuestion(query);
      const allEvidence: ResearchEvidence[] = [];
      const allGaps: ResearchGap[] = [];
      const allLowValueOutcomes: ResearchLowValueOutcome[] = [];
      const previousQueries: string[] = [];
      // Only searches the worker actually started count as passes.
      const executedQueries: string[] = [];
      const suggestedHeadlessUrls: string[] = [];
      const attemptedHeadlessUrls = new Set<string>();
      // Only discretionary escalations consume the decider's two attempts.
      // Direct links reserve one independent retry each.
      let headlessAttempts = 0;
      let directHeadlessAttempts = 0;
      let lastPass: ResearchWorkerResult | undefined;
      let partialWorkerPass: ResearchWorkerResult | undefined;
      let searchCoveragePartial = false;
      const fanoutProvidersSeen = new Set<SearchProviderName>();
      const fanoutSkippedSeen = new Set<SearchProviderName>();
      // Search and fetch attempts from every pass and direct URL, for verbose provenance.
      const runAttempts: Attempt[] = [];
      const requiredSourceEvidence: ResearchEvidence[] = [];
      const requiredSourceFailures: RequiredSourceFailure[] = [];
      // Search backends that failed for a reason the user can fix, deduplicated across passes.
      const searchUnavailable: SearchUnavailable[] = [];
      const recordSearchUnavailable = (entries: SearchUnavailable[]) => {
        for (const entry of entries) {
          if (!searchUnavailable.some((seen) => seen.provider === entry.provider && seen.kind === entry.kind && seen.message === entry.message)) {
            searchUnavailable.push(entry);
          }
        }
      };
      const requiredFailure = (url: string, reason: RequiredSourceFailure['reason'], code: string, message: string, failure?: RequiredSourceFailure['failure']) => {
        requiredSourceFailures.push({ url, reason, code, message, ...(failure ? { failure } : {}) });
        if (reason === 'read-failed') allGaps.push({ kind: 'fetch-failed', message: directUnreadableMessage(url) });
      };
      const complete = (result: Omit<ResearchOrchestratorResult, 'requiredSourceEvidence' | 'requiredSourceFailures'>): ResearchOrchestratorResult => {
        const hasRequiredFailure = requiredSourceFailures.length > 0;
        return {
          ...result,
          ...(hasRequiredFailure && result.decision.action === 'answer'
            ? { decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked: result.evidence, exhaustedBudget: result.metadata.exhaustedBudget }) }
            : {}),
          requiredSourceEvidence: [...requiredSourceEvidence],
          requiredSourceFailures: [...requiredSourceFailures],
          ...(searchUnavailable.length ? { searchUnavailable: [...searchUnavailable] } : {}),
          metadata: {
            ...result.metadata,
            caveatReasons: hasRequiredFailure
              ? [...new Set([...result.metadata.caveatReasons, 'unreadable-direct-source' as EvidenceCaveatReason])]
              : result.metadata.caveatReasons,
            ...(hasRequiredFailure ? { requiredSourceFailures: [...requiredSourceFailures] } : {})
          }
        };
      };

      const partialBudgetResult = (): ResearchOrchestratorResult => {
        const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
        const missingTargets = missingComparisonTargets(intent, ranked);
        const quality = analyzeEvidenceQuality({
          evidence: ranked,
          gaps: allGaps,
          lowValueOutcomes: allLowValueOutcomes,
          partialSearchCoverage: searchCoveragePartial,
          opinionQuestion,
          missingComparisonTargets: missingTargets
        });
        const snapshot = budget.snapshot();
        return complete({
          decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked, exhaustedBudget: true }),
          evidence: ranked,
          workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: true }),
          metadata: buildMetadata({
            executedQueries,
            allEvidence,
            allGaps,
            allLowValueOutcomes,
            headlessAttempts,
            exhaustedBudget: true,
            caveatReasons: [...quality.caveatReasons, 'budget-exhausted'],
            missingComparisonTargets: missingTargets,
            budgetReason: snapshot.limitReason,
            ...fanoutSnapshot()
          })
        });
      };

      function fanoutSnapshot() {
        const providers = fanoutProvidersSeen.size ? [...fanoutProvidersSeen] : undefined;
        const skipped = [...fanoutSkippedSeen].filter((p) => !fanoutProvidersSeen.has(p));
        return {
          fanoutProviders: providers,
          fanoutSkipped: skipped.length ? skipped : undefined,
          attempts: [...runAttempts],
          budget: budget.snapshot(),
          presentationStats: presentationStats.snapshot(),
          ...(requiredSourceFailures.length ? { requiredSourceFailures } : {})
        };
      }

      const terminal = (terminalFailure: { code: string; message: string }) => complete({
        decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked: [], exhaustedBudget: false }),
        evidence: [],
        workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: false }),
        metadata: buildMetadata({ executedQueries, allEvidence, allGaps, allLowValueOutcomes, headlessAttempts, exhaustedBudget: false, ...fanoutSnapshot() }),
        terminalFailure
      });

      try {
      // Walk the user's links in their original order. A repo alias is the same
      // source, but a distinct page link is always an independently required read.
      const repoUrls = typedUrls.filter((url) => parseRepoUrl(url) !== undefined);
      const repoKeys = new Set<string>();
      const acceptedRepoUrls = new Set<string>();
      const uniqueRepoUrls = repoUrls.filter((url) => {
        const target = parseRepoUrl(url)!;
        const key = `${target.owner.toLowerCase()}/${target.repo.toLowerCase()}\0${target.refAndPath ?? ''}`;
        if (repoKeys.has(key)) return false;
        repoKeys.add(key);
        acceptedRepoUrls.add(url);
        return true;
      });
      // Decided up front so each started line can say "link N of M".
      const acceptedLinks: string[] = [];
      let acceptedRepoLinks = 0;
      for (const url of typedUrls) {
        const repoTarget = parseRepoUrl(url);
        if (repoTarget && !acceptedRepoUrls.has(url)) continue;
        if (acceptedLinks.length >= 8 || (repoTarget && acceptedRepoLinks >= REPO_MAX_TYPED_REPOS)) continue;
        acceptedLinks.push(url);
        if (repoTarget) acceptedRepoLinks++;
      }
      const linkPositions = new Map(acceptedLinks.map((url, offset) => [url, { index: offset + 1, total: acceptedLinks.length }]));
      for (const url of typedUrls) {
        const repoTarget = parseRepoUrl(url);
        const repo = researchRepo && repoTarget;
        // Repo aliases are already represented by the first spelling.
        if (repoTarget && !acceptedRepoUrls.has(url)) continue;
        const linkPosition = linkPositions.get(url);
        if (!linkPosition) {
          requiredFailure(url, 'limit', 'DIRECT_SOURCE_LIMIT', 'Source limit reached; use a follow-up call for this URL.');
          continue;
        }
        if (repo) {
          throwIfAborted(signal);
          if (!budget.claimFetch(url)) {
            requiredFailure(url, budget.deadlineReached() ? 'deadline-unvisited' : 'limit', budget.deadlineReached() ? 'DIRECT_SOURCE_DEADLINE' : 'DIRECT_SOURCE_LIMIT', budget.deadlineReached() ? 'Source deadline reached before this URL could be read.' : 'Source limit reached; use a follow-up call for this URL.');
            continue;
          }
          emit('fetch', 'started', url, linkPosition);
          let researched: RepoResearchResult;
          try {
            researched = await budget.wait(researchRepo!({ url, query, signal: budget.signal }));
            if (researched.ok) presentationStats.recordRead(researched.response, 'repo', url);
            else presentationStats.recordFailure(url);
          }
          catch (error) {
            if (signal?.aborted) throw error;
            presentationStats.recordFailure(url);
            requiredFailure(url, budget.deadlineReached() ? 'deadline-in-flight' : 'read-failed', budget.deadlineReached() ? 'DIRECT_SOURCE_DEADLINE' : 'DIRECT_SOURCE_READ_FAILED', budget.deadlineReached() ? 'Source deadline reached while reading this URL.' : `Direct URL could not be read reliably: ${url}`);
            continue;
          } finally {
            emit('fetch', 'settled', url);
          }
          throwIfAborted(signal);
          if (!researched.ok) { requiredFailure(url, 'read-failed', researched.error.code, researched.error.message, researched.error.failure); continue; }
          const repoEvidence = evidenceFromFetch(researched.response, query, { trustedContent: true, requestedUrl: url });
          if (repoEvidence) { allEvidence.push(repoEvidence); requiredSourceEvidence.push(repoEvidence); }
          else requiredFailure(url, 'read-failed', 'DIRECT_SOURCE_READ_FAILED', `Direct URL could not be read reliably: ${url}`);
          continue;
        }
        if (!fetchDirect) {
          requiredFailure(url, 'read-failed', 'DIRECT_SOURCE_READ_FAILED', `Direct URL could not be read reliably: ${url}`);
          continue;
        }
        throwIfAborted(signal);
        if (!budget.claimFetch(url)) {
          requiredFailure(url, budget.deadlineReached() ? 'deadline-unvisited' : 'limit', budget.deadlineReached() ? 'DIRECT_SOURCE_DEADLINE' : 'DIRECT_SOURCE_LIMIT', budget.deadlineReached() ? 'Source deadline reached before this URL could be read.' : 'Source limit reached; use a follow-up call for this URL.');
          continue;
        }
        emit('fetch', 'started', url, linkPosition);
        let directResult: WebFetchResponse;
        try {
          directResult = await budget.wait(fetchDirect({ url, query, signal: budget.signal }));
          presentationStats.recordRead(directResult, undefined, url);
        }
        catch (error) {
          if (signal?.aborted) throw error;
          presentationStats.recordFailure(url);
          requiredFailure(url, budget.deadlineReached() ? 'deadline-in-flight' : 'read-failed', budget.deadlineReached() ? 'DIRECT_SOURCE_DEADLINE' : 'DIRECT_SOURCE_READ_FAILED', budget.deadlineReached() ? 'Source deadline reached while reading this URL.' : `Direct URL could not be read reliably: ${url}`);
          continue;
        } finally {
          emit('fetch', 'settled', url);
        }
        throwIfAborted(signal);
        if (directResult.metadata.attempts) runAttempts.push(...directResult.metadata.attempts);
        const directEvidence = evidenceFromFetch(directResult, query, { requestedUrl: url });
          if (directEvidence) {
            allEvidence.push(directEvidence);
            requiredSourceEvidence.push(directEvidence);
            continue;
          }
          if (!isTerminalFailure(failureOf(directResult)) && shouldRetryDirectWithHeadless(directResult, directEvidence)) {
            if (directHeadlessAttempts < 8 && budget.claimHeadless()) {
              emit('headless', 'started', directResult.url, linkPosition);
              directHeadlessAttempts++;
              attemptedHeadlessUrls.add(directResult.url);
              throwIfAborted(signal);
              let headlessResult: WebFetchHeadlessResponse;
              try {
                const headlessWork = headlessFetch({ url: directResult.url, query, signal: budget.signal });
                headlessResult = await budget.wait(headlessWork);
                presentationStats.recordRead(headlessResult, undefined, directResult.url);
              } catch (error) {
                if (signal?.aborted) throw error;
                presentationStats.recordFailure(directResult.url);
                requiredFailure(url, budget.deadlineReached() ? 'deadline-in-flight' : 'read-failed', budget.deadlineReached() ? 'DIRECT_SOURCE_DEADLINE' : 'DIRECT_SOURCE_READ_FAILED', budget.deadlineReached() ? 'Source deadline reached while reading this URL.' : directUnreadableMessage(directResult.url));
                continue;
              } finally {
                emit('headless', 'settled', directResult.url);
              }
              throwIfAborted(signal);
              const headlessEvidence = evidenceFromHeadless(headlessResult, query, url);
              if (headlessEvidence) {
                allEvidence.push(headlessEvidence);
                requiredSourceEvidence.push(headlessEvidence);
              } else {
                requiredFailure(url, 'read-failed', 'DIRECT_SOURCE_READ_FAILED', directUnreadableMessage(directResult.url));
              }
            } else {
              requiredFailure(url, 'limit', 'DIRECT_SOURCE_LIMIT', 'Source limit reached; use a follow-up call for this URL.');
            }
          } else {
            requiredFailure(url, 'read-failed', directResult.error?.code ?? 'DIRECT_SOURCE_READ_FAILED', directResult.error?.message ?? directUnreadableMessage(directResult.url), directResult.error?.failure);
          }
      }

      if (intent.kind === 'read') {
        const exhaustedBudget = budget.deadlineReached();
        const snapshot = budget.snapshot();
        const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
        const quality = analyzeEvidenceQuality({
          evidence: ranked,
          gaps: allGaps,
          lowValueOutcomes: allLowValueOutcomes,
          partialSearchCoverage: searchCoveragePartial,
          opinionQuestion
        });
        return complete({
          decision: decisionForAnswer({ action: ranked.length && requiredSourceFailures.length === 0 && !exhaustedBudget ? 'answer' : 'answer-with-caveat', query, ranked, exhaustedBudget }),
          evidence: ranked,
          workerPass: combinedWorkerPass({
            lastPass,
            previousQueries,
            allGaps,
            allLowValueOutcomes,
            exhaustedBudget
          }),
          metadata: buildMetadata({
            executedQueries,
            allEvidence,
            allGaps,
            allLowValueOutcomes,
            headlessAttempts,
            exhaustedBudget,
            caveatReasons: [...quality.caveatReasons.filter((reason) => reason !== 'unknown-authority'), ...(requiredSourceFailures.length ? ['unreadable-direct-source' as EvidenceCaveatReason] : []), ...(exhaustedBudget ? ['budget-exhausted' as EvidenceCaveatReason] : [])],
            budgetReason: snapshot.limitReason,
            ...fanoutSnapshot(), requiredSourceFailures
          })
        });
      }

      if (intent.kind === 'compare' && allEvidence.length >= 2 && missingComparisonTargets(intent, allEvidence).length === 0) {
        const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
        const quality = analyzeEvidenceQuality({ evidence: ranked, gaps: allGaps, lowValueOutcomes: allLowValueOutcomes, opinionQuestion });
        const decision = decideNextResearchStep({
          evidence: ranked, suggestedHeadlessUrls: [], passIndex: 0, maxPasses: DEFAULT_MAX_PASSES,
          headlessAttempts, maxHeadlessAttempts: DEFAULT_MAX_HEADLESS_ATTEMPTS, quality, opinionQuestion
        });
        if (decision.action === 'answer' || decision.action === 'answer-with-caveat') {
          return complete({
            decision: decisionForAnswer({ action: decision.action, query, ranked, exhaustedBudget: false }),
            evidence: ranked,
            workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: false }),
            metadata: buildMetadata({ executedQueries, allEvidence, allGaps, allLowValueOutcomes, headlessAttempts, exhaustedBudget: false, caveatReasons: quality.caveatReasons, ...fanoutSnapshot() })
          });
        }
      }

      for (let passIndex = 0; passIndex < DEFAULT_MAX_PASSES; passIndex++) {
        const evidenceText = allEvidence.flatMap((item) => [item.title, item.summary, ...item.supports]).join(' ');
        const planningGaps = [
          ...allGaps.map((gap) => gap.message),
          ...missingComparisonTargets(intent, allEvidence).map((target) => `Need comparison evidence for target: ${target}`)
        ];
        if (/\b(?:versions?|compatibility|supported since)\b/i.test(query) && !/\bv?\d+\.\d+(?:\.\d+)?\b/i.test(evidenceText)) {
          planningGaps.push('Need supported version details.');
        }
        if (/\b(?:API|method|function|parameter)\b/i.test(query) && allEvidence.length === 0) {
          planningGaps.push('Need exact API behavior.');
        }
        if (opinionQuestion && !allEvidence.some((item) => item.sourceKind === 'community' || item.sourceKind === 'issue-thread' || item.sourceKind === 'official-discussion')) {
          planningGaps.push('Need user experience.');
        }
        if (analyzeEvidenceQuality({ evidence: allEvidence, gaps: allGaps, lowValueOutcomes: allLowValueOutcomes }).flags.hasPossibleConflict) {
          planningGaps.push('Sources disagree about the recommendation.');
        }
        const queries = planSearchQueries({
          originalQuery: query,
          passIndex,
          previousQueries,
          gaps: planningGaps
        });

        for (const plannedQuery of queries) {
          previousQueries.push(plannedQuery);
          throwIfAborted(signal);
          partialWorkerPass = undefined;
          const searchesBefore = budget.snapshot().searches;
          const workerWork = worker.run({
            query: plannedQuery,
            maxSearchRounds: 1,
            maxFetches: DEFAULT_MAX_FETCHES_PER_PASS,
            signal,
            budget,
            presentationStats,
            onProgress,
            onPartial: (partial) => { partialWorkerPass = partial; }
          });
          // A search counts once the worker claimed it, even when that worker call then throws.
          const pass = await budget.wait(workerWork).finally(() => {
            if (budget.snapshot().searches > searchesBefore) executedQueries.push(plannedQuery);
          });
          partialWorkerPass = undefined;
          throwIfAborted(signal);

          lastPass = pass;
          if (pass.searchAttempts) runAttempts.push(...pass.searchAttempts);
          if (pass.fetchAttempts) runAttempts.push(...pass.fetchAttempts);
          if (pass.searchCoveragePartial) searchCoveragePartial = true;
          if (pass.terminalFailure) {
            return complete({
              decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked: [], exhaustedBudget: false }),
              evidence: [],
              workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: false }),
              metadata: buildMetadata({ executedQueries, allEvidence, allGaps, allLowValueOutcomes, headlessAttempts, exhaustedBudget: false, ...fanoutSnapshot() }),
              terminalFailure: pass.terminalFailure
            });
          }
          pass.fanoutProviders?.forEach((p) => fanoutProvidersSeen.add(p));
          pass.fanoutSkipped?.forEach((p) => fanoutSkippedSeen.add(p));
          allEvidence.push(...pass.evidence);
          allGaps.push(...pass.gaps);
          allLowValueOutcomes.push(...pass.lowValueOutcomes);
          if (pass.suggestedHeadlessUrl) suggestedHeadlessUrls.push(pass.suggestedHeadlessUrl);
          if (pass.searchUnavailable) recordSearchUnavailable(pass.searchUnavailable);
          // Every provider in the chain needs a fix first, so the remaining planned queries would fail the same way.
          if (pass.searchUnavailableOnly) {
            const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
            return complete({
              decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked, exhaustedBudget: false }),
              evidence: ranked,
              workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: false }),
              metadata: buildMetadata({ executedQueries, allEvidence, allGaps, allLowValueOutcomes, headlessAttempts, exhaustedBudget: false, ...fanoutSnapshot() })
            });
          }
          if (pass.exhaustedBudget) return partialBudgetResult();

          const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
          const missingTargets = missingComparisonTargets(intent, ranked);
          const quality = analyzeEvidenceQuality({
            evidence: ranked,
            gaps: allGaps,
            lowValueOutcomes: allLowValueOutcomes,
            partialSearchCoverage: searchCoveragePartial,
            opinionQuestion,
            missingComparisonTargets: missingTargets
          });
          const decision = decideNextResearchStep({
            evidence: ranked,
            suggestedHeadlessUrls: suggestedHeadlessUrls.filter((url) => !attemptedHeadlessUrls.has(url)),
            passIndex,
            maxPasses: DEFAULT_MAX_PASSES,
            headlessAttempts,
            maxHeadlessAttempts: DEFAULT_MAX_HEADLESS_ATTEMPTS,
            quality,
            opinionQuestion
          });

          if (decision.action === 'headless') {
            if (!budget.claimHeadless()) return partialBudgetResult();
            emit('headless', 'started', decision.url);
            headlessAttempts++;
            attemptedHeadlessUrls.add(decision.url);
            throwIfAborted(signal);
            let headlessResult: WebFetchHeadlessResponse;
            try {
              const headlessWork = headlessFetch({ url: decision.url, query, signal: budget.signal });
              headlessResult = await budget.wait(headlessWork);
              presentationStats.recordRead(headlessResult, undefined, decision.url);
            } catch (error) {
              if (!signal?.aborted) presentationStats.recordFailure(decision.url);
              throw error;
            } finally {
              emit('headless', 'settled', decision.url);
            }
            throwIfAborted(signal);
            const headlessEvidence = evidenceFromHeadless(headlessResult, query);
            if (headlessEvidence) {
              allEvidence.push(headlessEvidence);
              const updatedRanked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
              const updatedMissingTargets = missingComparisonTargets(intent, updatedRanked);
              const updatedQuality = analyzeEvidenceQuality({
                evidence: updatedRanked,
                gaps: allGaps,
                lowValueOutcomes: allLowValueOutcomes,
                partialSearchCoverage: searchCoveragePartial,
                opinionQuestion,
                missingComparisonTargets: updatedMissingTargets
              });
              const updatedDecision = decideNextResearchStep({
                evidence: updatedRanked,
                suggestedHeadlessUrls: [],
                passIndex,
                maxPasses: DEFAULT_MAX_PASSES,
                headlessAttempts,
                maxHeadlessAttempts: DEFAULT_MAX_HEADLESS_ATTEMPTS,
                quality: updatedQuality,
                opinionQuestion
              });

              const needsMoreResearch = updatedDecision.action === 'search-again' || updatedMissingTargets.length > 0;
              if (needsMoreResearch && (passIndex + 1 < DEFAULT_MAX_PASSES || plannedQuery !== queries.at(-1))) {
                continue;
              }
              const exhaustedBudget = needsMoreResearch && passIndex + 1 >= DEFAULT_MAX_PASSES;
              return complete({
                decision: decisionForAnswer({
                  action: !needsMoreResearch && updatedDecision.action === 'answer' ? 'answer' : 'answer-with-caveat',
                  query,
                  ranked: updatedRanked,
                  exhaustedBudget
                }),
                evidence: updatedRanked,
                workerPass: combinedWorkerPass({
                  lastPass,
                  previousQueries,
                  allGaps,
                  allLowValueOutcomes,
                  exhaustedBudget
                }),
                metadata: buildMetadata({
                  executedQueries,
                  allEvidence,
                  allGaps,
                  allLowValueOutcomes,
                  headlessAttempts,
                  exhaustedBudget,
                  caveatReasons: updatedQuality.caveatReasons,
                  missingComparisonTargets: updatedMissingTargets,
                  ...fanoutSnapshot()
                })
              });
            }

            return complete({
              decision: {
                action: 'escalate-headless',
                rationale: 'One high-value page is worth a single orchestrator-approved headless retry.',
                url: decision.url,
                approvedEvidence: ranked
              } satisfies ResearchOrchestratorDecision,
              evidence: ranked,
              workerPass: combinedWorkerPass({
                lastPass,
                previousQueries,
                allGaps,
                allLowValueOutcomes,
                exhaustedBudget: false
              }),
              metadata: buildMetadata({
                executedQueries,
                allEvidence,
                allGaps,
                allLowValueOutcomes,
                headlessAttempts,
                exhaustedBudget: false,
                caveatReasons: quality.caveatReasons,
                missingComparisonTargets: missingTargets,
                ...fanoutSnapshot()
              })
            });
          }

          if (decision.action === 'answer' || decision.action === 'answer-with-caveat') {
            if (missingTargets.length > 0 && (passIndex + 1 < DEFAULT_MAX_PASSES || plannedQuery !== queries.at(-1))) {
              continue;
            }
            const exhaustedBudget = decision.action === 'answer-with-caveat' && passIndex + 1 >= DEFAULT_MAX_PASSES;
            return complete({
              decision: decisionForAnswer({ action: missingTargets.length ? 'answer-with-caveat' : decision.action, query, ranked, exhaustedBudget }),
              evidence: ranked,
              workerPass: combinedWorkerPass({
                lastPass,
                previousQueries,
                allGaps,
                allLowValueOutcomes,
                exhaustedBudget
              }),
              metadata: buildMetadata({
                executedQueries,
                allEvidence,
                allGaps,
                allLowValueOutcomes,
                headlessAttempts,
                exhaustedBudget,
                caveatReasons: quality.caveatReasons,
                missingComparisonTargets: missingTargets,
                ...fanoutSnapshot()
              })
            });
          }
        }
      }

      const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
      const missingTargets = missingComparisonTargets(intent, ranked);
      const quality = analyzeEvidenceQuality({
        evidence: ranked,
        gaps: allGaps,
        lowValueOutcomes: allLowValueOutcomes,
        partialSearchCoverage: searchCoveragePartial,
        opinionQuestion,
        missingComparisonTargets: missingTargets
      });
      return complete({
        decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked, exhaustedBudget: true }),
        evidence: ranked,
        workerPass: combinedWorkerPass({
          lastPass,
          previousQueries,
          allGaps,
          allLowValueOutcomes,
          exhaustedBudget: true
        }),
        metadata: buildMetadata({
          executedQueries,
          allEvidence,
          allGaps,
          allLowValueOutcomes,
          headlessAttempts,
          exhaustedBudget: true,
          caveatReasons: quality.caveatReasons,
          missingComparisonTargets: missingTargets,
          ...fanoutSnapshot()
        })
      });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (budget.deadlineReached()) {
          if (partialWorkerPass) {
            const partial = partialWorkerPass;
            lastPass = partial;
            if (partial.searchAttempts) runAttempts.push(...partial.searchAttempts);
            if (partial.fetchAttempts) runAttempts.push(...partial.fetchAttempts);
            if (partial.searchCoveragePartial) searchCoveragePartial = true;
            partial.fanoutProviders?.forEach((provider) => fanoutProvidersSeen.add(provider));
            partial.fanoutSkipped?.forEach((provider) => fanoutSkippedSeen.add(provider));
            allEvidence.push(...partial.evidence);
            allGaps.push(...partial.gaps);
            allLowValueOutcomes.push(...partial.lowValueOutcomes);
          }
          return partialBudgetResult();
        }
        throw error;
      } finally {
        budget.dispose();
      }
    },
    async drain() {
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    }
  };
}
