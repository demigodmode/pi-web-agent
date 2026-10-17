import type { Attempt, ResearchFetchInput, SearchProviderName, WebFetchHeadlessResponse, WebFetchResponse } from '../types.js';
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
  ResearchWorkerResult
} from './research-types.js';
import { decideNextResearchStep } from './stop-decider.js';
import { analyzeEvidenceQuality, type EvidenceCaveatReason } from './evidence-quality.js';
import { selectRelevantExcerpt } from '../extract/section-selector.js';
import { selectEvidencePassages } from './evidence-passages.js';
import { hasBotCheckContent } from '../extract/bot-check.js';
import { REPO_MAX_TYPED_REPOS } from '../repo/limits.js';
import type { RepoResearchInput, RepoResearchResult } from '../repo/repo-research.js';
import { parseRepoUrl } from '../repo/repo-url.js';
import { classifyResearchIntent, missingComparisonTargets } from './research-intent.js';
import { createResearchRunBudget, type ResearchBudgetReason, type ResearchBudgetSnapshot } from './run-budget.js';
import type { ResearchProgress } from './progress.js';

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
  return /\b(opinions?|experiences?|reviews?|what do (?:users|people|developers) think|reddit|forum discussions?)\b/i.test(query);
}

function isBotCheckContent({ title = '', text, botCheck }: { title?: string; text: string; botCheck?: boolean }) {
  if (botCheck) return true;
  return hasBotCheckContent(`${title}\n${text}`);
}

function evidenceFromFetch(result: WebFetchResponse, query: string, { trustedContent = false }: { trustedContent?: boolean } = {}): ResearchEvidence | null {
  if (result.status !== 'ok' || !result.content?.text.trim()) return null;
  if (!trustedContent && isBotCheckContent({ title: result.content.title, text: result.content.text, botCheck: result.content.botCheck })) return null;

  if (isReaderMethod(result.metadata.method)) {
    return {
      title: result.content.title ?? result.url,
      url: result.url,
      sourceKind: classifyEvidenceUrl(result.url),
      method: result.metadata.method,
      summary: result.content.text,
      supports: [result.content.text],
      ...(result.content.sectionAnchor ? { sectionAnchor: result.content.sectionAnchor } : {}),
      ...(result.metadata.cacheHit === false ? { retrievedAt: new Date().toISOString() } : {}),
      truncated: result.metadata.truncated ?? false
    };
  }

  const passages = selectEvidencePassages(result.content.text, query);
  return {
    title: result.content.title ?? result.url,
    url: result.url,
    sourceKind: classifyEvidenceUrl(result.url),
    method: result.metadata.method,
    summary: selectRelevantExcerpt(result.content.text, query, 180),
    supports: passages.excerpts,
    ...(result.content.sectionAnchor ? { sectionAnchor: result.content.sectionAnchor } : {}),
    ...(result.metadata.cacheHit === false ? { retrievedAt: new Date().toISOString() } : {}),
    truncated: (result.metadata.truncated ?? false) || passages.truncated
  };
}

function evidenceFromHeadless(result: WebFetchHeadlessResponse, query: string): ResearchEvidence | null {
  if (result.status !== 'ok' || !result.content?.text.trim()) return null;
  if (isBotCheckContent({ title: result.content.title, text: result.content.text, botCheck: result.content.botCheck })) return null;

  const passages = selectEvidencePassages(result.content.text, query);
  return {
    title: result.content.title ?? result.url,
    url: result.url,
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
  previousQueries,
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
  budget
}: {
  previousQueries: string[];
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
}) {
  return {
    searchPasses: previousQueries.length,
    fetchedPages: allEvidence.length + allGaps.length + allLowValueOutcomes.length,
    headlessAttempts,
    exhaustedBudget,
    caveatReasons,
    missingComparisonTargets,
    fanoutProviders,
    fanoutSkipped,
    budgetReason,
    budget,
    ...(attempts && attempts.length > 0 ? { attempts } : {})
  };
}

type ResearchOrchestratorResult = {
  decision: ResearchOrchestratorDecision;
  evidence: ResearchEvidence[];
  workerPass: ResearchWorkerResult;
  metadata: ReturnType<typeof buildMetadata>;
  terminalFailure?: { code: string; message: string };
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
      const budget = createResearchRunBudget({ signal, track });
      const emit = (phase: ResearchProgress['phase']) => {
        if (!onProgress) return;
        const { searches, fetches, headless } = budget.snapshot();
        try { onProgress({ phase, searches, fetches, headless }); } catch { /* Progress is observational. */ }
      };
      const intent = classifyResearchIntent(query);
      const opinionQuestion = isOpinionQuestion(query);
      const allEvidence: ResearchEvidence[] = [];
      const allGaps: ResearchGap[] = [];
      const allLowValueOutcomes: ResearchLowValueOutcome[] = [];
      const previousQueries: string[] = [];
      const suggestedHeadlessUrls: string[] = [];
      const attemptedHeadlessUrls = new Set<string>();
      let headlessAttempts = 0;
      let lastPass: ResearchWorkerResult | undefined;
      let searchCoveragePartial = false;
      const fanoutProvidersSeen = new Set<SearchProviderName>();
      const fanoutSkippedSeen = new Set<SearchProviderName>();
      // Search and fetch attempts from every pass and direct URL, for verbose provenance.
      const runAttempts: Attempt[] = [];

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
        return {
          decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked, exhaustedBudget: true }),
          evidence: ranked,
          workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: true }),
          metadata: buildMetadata({
            previousQueries,
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
        };
      };

      function fanoutSnapshot() {
        const providers = fanoutProvidersSeen.size ? [...fanoutProvidersSeen] : undefined;
        const skipped = [...fanoutSkippedSeen].filter((p) => !fanoutProvidersSeen.has(p));
        return { fanoutProviders: providers, fanoutSkipped: skipped.length ? skipped : undefined, attempts: [...runAttempts], budget: budget.snapshot() };
      }

      const terminal = (terminalFailure: { code: string; message: string }) => ({
        decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked: [], exhaustedBudget: false }),
        evidence: [],
        workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: false }),
        metadata: buildMetadata({ previousQueries, allEvidence, allGaps, allLowValueOutcomes, headlessAttempts, exhaustedBudget: false, ...fanoutSnapshot() }),
        terminalFailure
      });

      try {
      // Typed repo links are researched directly and consume the same bounded fetch allowance.
      const typedUrls = extractDirectUrls(query);
      const repoUrls = researchRepo ? typedUrls.filter((url) => parseRepoUrl(url) !== undefined) : [];
      const pageUrls = typedUrls.filter((url) => !repoUrls.includes(url));
      const repoKeys = new Set<string>();
      const uniqueRepoUrls = repoUrls.filter((url) => {
        const target = parseRepoUrl(url)!;
        const key = `${target.owner.toLowerCase()}/${target.repo.toLowerCase()}\0${target.refAndPath ?? ''}`;
        if (repoKeys.has(key)) return false;
        repoKeys.add(key);
        return true;
      });

      if (uniqueRepoUrls.length > REPO_MAX_TYPED_REPOS) {
        return terminal({ code: 'REPO_TOO_MANY', message: 'Too many repo links in one question; ask about one or two at a time.' });
      }
      for (const url of uniqueRepoUrls) {
        throwIfAborted(signal);
        if (!budget.claimFetch(url)) return partialBudgetResult();
        emit('fetch');
        const repoWork = researchRepo!({ url, query, signal: budget.signal });
        const researched = await budget.wait(repoWork);
        throwIfAborted(signal);
        // A typed repo that can't be researched ends the run: the README reader must not stand in for the code.
        if (!researched.ok) return terminal({ code: researched.error.code, message: researched.error.message });
        const repoEvidence = evidenceFromFetch(researched.response, query, { trustedContent: true });
        if (repoEvidence) allEvidence.push(repoEvidence);
        else allGaps.push({ kind: 'fetch-failed', message: `Nothing readable came back for ${url}.` });
      }

      if (fetchDirect) {
        for (const url of pageUrls.slice(0, 3)) {
          throwIfAborted(signal);
          if (!budget.claimFetch(url)) return partialBudgetResult();
          emit('fetch');
          const directWork = fetchDirect({ url, query, signal: budget.signal });
          const directResult = await budget.wait(directWork);
          throwIfAborted(signal);
          if (directResult.metadata.attempts) runAttempts.push(...directResult.metadata.attempts);
          const directEvidence = evidenceFromFetch(directResult, query);
          if (directEvidence) {
            allEvidence.push(directEvidence);
            continue;
          }

          if (isTerminalFailure(failureOf(directResult))) {
            allGaps.push({
              kind: 'fetch-failed',
              message: directResult.error?.message ?? `Direct URL fetch failed for ${directResult.url}`
            });
            continue;
          }

          if (shouldRetryDirectWithHeadless(directResult, directEvidence)) {
            if (headlessAttempts < DEFAULT_MAX_HEADLESS_ATTEMPTS) {
              if (!budget.claimHeadless()) return partialBudgetResult();
              emit('headless');
              headlessAttempts++;
              attemptedHeadlessUrls.add(directResult.url);
              throwIfAborted(signal);
              const headlessWork = headlessFetch({ url: directResult.url, query, signal: budget.signal });
              const headlessResult = await budget.wait(headlessWork);
              throwIfAborted(signal);
              const headlessEvidence = evidenceFromHeadless(headlessResult, query);
              if (headlessEvidence) {
                allEvidence.push(headlessEvidence);
              } else {
                allGaps.push({ kind: 'fetch-failed', message: directUnreadableMessage(directResult.url) });
              }
            } else {
              allGaps.push({ kind: 'fetch-failed', message: directUnreadableMessage(directResult.url) });
            }
          } else if (directResult.status !== 'ok') {
            allGaps.push({
              kind: 'fetch-failed',
              message: directResult.error?.message ?? `Direct URL fetch failed for ${directResult.url}`
            });
          } else {
            allGaps.push({ kind: 'fetch-failed', message: directUnreadableMessage(directResult.url) });
          }
        }
      }

      if (intent.kind === 'read' && allEvidence.some((item) => item.sourceKind !== 'package-page')) {
        const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
        const quality = analyzeEvidenceQuality({
          evidence: ranked,
          gaps: allGaps,
          lowValueOutcomes: allLowValueOutcomes,
          partialSearchCoverage: searchCoveragePartial,
          opinionQuestion
        });
        return {
          decision: decisionForAnswer({ action: 'answer', query, ranked, exhaustedBudget: false }),
          evidence: ranked,
          workerPass: combinedWorkerPass({
            lastPass,
            previousQueries,
            allGaps,
            allLowValueOutcomes,
            exhaustedBudget: false
          }),
          metadata: buildMetadata({
            previousQueries,
            allEvidence,
            allGaps,
            allLowValueOutcomes,
            headlessAttempts,
            exhaustedBudget: false,
            caveatReasons: quality.caveatReasons.filter((reason) => reason !== 'unknown-authority'),
            ...fanoutSnapshot()
          })
        };
      }

      if (intent.kind === 'compare' && allEvidence.length >= 2 && missingComparisonTargets(intent, allEvidence).length === 0) {
        const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
        const quality = analyzeEvidenceQuality({ evidence: ranked, gaps: allGaps, lowValueOutcomes: allLowValueOutcomes, opinionQuestion });
        const decision = decideNextResearchStep({
          evidence: ranked, suggestedHeadlessUrls: [], passIndex: 0, maxPasses: DEFAULT_MAX_PASSES,
          headlessAttempts, maxHeadlessAttempts: DEFAULT_MAX_HEADLESS_ATTEMPTS, quality, opinionQuestion
        });
        if (decision.action === 'answer' || decision.action === 'answer-with-caveat') {
          return {
            decision: decisionForAnswer({ action: decision.action, query, ranked, exhaustedBudget: false }),
            evidence: ranked,
            workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: false }),
            metadata: buildMetadata({ previousQueries, allEvidence, allGaps, allLowValueOutcomes, headlessAttempts, exhaustedBudget: false, caveatReasons: quality.caveatReasons, ...fanoutSnapshot() })
          };
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
          const workerWork = worker.run({
            query: plannedQuery,
            maxSearchRounds: 1,
            maxFetches: DEFAULT_MAX_FETCHES_PER_PASS,
            signal,
            budget,
            onProgress
          });
          const pass = await budget.wait(workerWork);
          throwIfAborted(signal);

          lastPass = pass;
          if (pass.searchAttempts) runAttempts.push(...pass.searchAttempts);
          if (pass.fetchAttempts) runAttempts.push(...pass.fetchAttempts);
          if (pass.searchCoveragePartial) searchCoveragePartial = true;
          if (pass.terminalFailure) {
            return {
              decision: decisionForAnswer({ action: 'answer-with-caveat', query, ranked: [], exhaustedBudget: false }),
              evidence: [],
              workerPass: combinedWorkerPass({ lastPass, previousQueries, allGaps, allLowValueOutcomes, exhaustedBudget: false }),
              metadata: buildMetadata({ previousQueries, allEvidence, allGaps, allLowValueOutcomes, headlessAttempts, exhaustedBudget: false, ...fanoutSnapshot() }),
              terminalFailure: pass.terminalFailure
            };
          }
          pass.fanoutProviders?.forEach((p) => fanoutProvidersSeen.add(p));
          pass.fanoutSkipped?.forEach((p) => fanoutSkippedSeen.add(p));
          allEvidence.push(...pass.evidence);
          allGaps.push(...pass.gaps);
          allLowValueOutcomes.push(...pass.lowValueOutcomes);
          if (pass.suggestedHeadlessUrl) suggestedHeadlessUrls.push(pass.suggestedHeadlessUrl);
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
            emit('headless');
            headlessAttempts++;
            attemptedHeadlessUrls.add(decision.url);
            throwIfAborted(signal);
            const headlessWork = headlessFetch({ url: decision.url, query, signal: budget.signal });
            const headlessResult = await budget.wait(headlessWork);
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
              return {
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
                  previousQueries,
                  allEvidence,
                  allGaps,
                  allLowValueOutcomes,
                  headlessAttempts,
                  exhaustedBudget,
                  caveatReasons: updatedQuality.caveatReasons,
                  missingComparisonTargets: updatedMissingTargets,
                  ...fanoutSnapshot()
                })
              };
            }

            return {
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
                previousQueries,
                allEvidence,
                allGaps,
                allLowValueOutcomes,
                headlessAttempts,
                exhaustedBudget: false,
                caveatReasons: quality.caveatReasons,
                missingComparisonTargets: missingTargets,
                ...fanoutSnapshot()
              })
            };
          }

          if (decision.action === 'answer' || decision.action === 'answer-with-caveat') {
            if (missingTargets.length > 0 && (passIndex + 1 < DEFAULT_MAX_PASSES || plannedQuery !== queries.at(-1))) {
              continue;
            }
            const exhaustedBudget = decision.action === 'answer-with-caveat' && passIndex + 1 >= DEFAULT_MAX_PASSES;
            return {
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
                previousQueries,
                allEvidence,
                allGaps,
                allLowValueOutcomes,
                headlessAttempts,
                exhaustedBudget,
                caveatReasons: quality.caveatReasons,
                missingComparisonTargets: missingTargets,
                ...fanoutSnapshot()
              })
            };
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
      return {
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
          previousQueries,
          allEvidence,
          allGaps,
          allLowValueOutcomes,
          headlessAttempts,
          exhaustedBudget: true,
          caveatReasons: quality.caveatReasons,
          missingComparisonTargets: missingTargets,
          ...fanoutSnapshot()
        })
      };
      } catch (error) {
        if (signal?.aborted) throw error;
        if (budget.deadlineReached()) return partialBudgetResult();
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
