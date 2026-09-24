import type { Attempt, ResearchFetchInput, SearchProviderName, WebFetchHeadlessResponse, WebFetchResponse } from '../types.js';
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
import { hasBotCheckContent } from '../extract/bot-check.js';

const DEFAULT_MAX_PASSES = 3;
const DEFAULT_MAX_FETCHES_PER_PASS = 4;
const DEFAULT_MAX_HEADLESS_ATTEMPTS = 2;

function classifyEvidenceUrl(url: string): ResearchEvidence['sourceKind'] {
  return classifySourceProfile(url).sourceKind;
}

function isReaderMethod(method: string): boolean {
  return method === 'github' || method === 'pdf' || method === 'youtube';
}

function isBotCheckContent({ title = '', text, botCheck }: { title?: string; text: string; botCheck?: boolean }) {
  if (botCheck) return true;
  return hasBotCheckContent(`${title}\n${text}`);
}

function evidenceFromFetch(result: WebFetchResponse, query: string): ResearchEvidence | null {
  if (result.status !== 'ok' || !result.content?.text.trim()) return null;
  if (isBotCheckContent({ title: result.content.title, text: result.content.text, botCheck: result.content.botCheck })) return null;

  if (isReaderMethod(result.metadata.method)) {
    return {
      title: result.content.title ?? result.url,
      url: result.url,
      sourceKind: 'primary-content',
      method: result.metadata.method,
      summary: result.content.text,
      supports: [result.content.text]
    };
  }

  return {
    title: result.content.title ?? result.url,
    url: result.url,
    sourceKind: classifyEvidenceUrl(result.url),
    method: result.metadata.method,
    summary: selectRelevantExcerpt(result.content.text, query, 180),
    supports: [selectRelevantExcerpt(result.content.text, query, 120)]
  };
}

function evidenceFromHeadless(result: WebFetchHeadlessResponse, query: string): ResearchEvidence | null {
  if (result.status !== 'ok' || !result.content?.text.trim()) return null;
  if (isBotCheckContent({ title: result.content.title, text: result.content.text, botCheck: result.content.botCheck })) return null;

  return {
    title: result.content.title ?? result.url,
    url: result.url,
    sourceKind: classifyEvidenceUrl(result.url),
    method: 'headless',
    summary: selectRelevantExcerpt(result.content.text, query, 180),
    supports: [selectRelevantExcerpt(result.content.text, query, 120)]
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
  fanoutProviders,
  fanoutSkipped,
  attempts
}: {
  previousQueries: string[];
  allEvidence: ResearchEvidence[];
  allGaps: ResearchGap[];
  allLowValueOutcomes: ResearchLowValueOutcome[];
  headlessAttempts: number;
  exhaustedBudget: boolean;
  caveatReasons?: EvidenceCaveatReason[];
  fanoutProviders?: SearchProviderName[];
  fanoutSkipped?: SearchProviderName[];
  attempts?: Attempt[];
}) {
  return {
    searchPasses: previousQueries.length,
    fetchedPages: allEvidence.length + allGaps.length + allLowValueOutcomes.length,
    headlessAttempts,
    exhaustedBudget,
    caveatReasons,
    fanoutProviders,
    fanoutSkipped,
    ...(attempts && attempts.length > 0 ? { attempts } : {})
  };
}

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
  headlessFetch
}: {
  worker: {
    run: (input: {
      query: string;
      maxSearchRounds: number;
      maxFetches: number;
    }) => Promise<ResearchWorkerResult>;
  };
  fetchDirect?: (input: ResearchFetchInput) => Promise<WebFetchResponse>;
  headlessFetch: (input: ResearchFetchInput) => Promise<WebFetchHeadlessResponse>;
}) {
  return {
    async run({ query }: { query: string }) {
      const allEvidence: ResearchEvidence[] = [];
      const allGaps: ResearchGap[] = [];
      const allLowValueOutcomes: ResearchLowValueOutcome[] = [];
      const previousQueries: string[] = [];
      const suggestedHeadlessUrls: string[] = [];
      let headlessAttempts = 0;
      let lastPass: ResearchWorkerResult | undefined;
      let searchCoveragePartial = false;
      const fanoutProvidersSeen = new Set<SearchProviderName>();
      const fanoutSkippedSeen = new Set<SearchProviderName>();
      // Search and fetch attempts from every pass and direct URL, for verbose provenance.
      const runAttempts: Attempt[] = [];

      function fanoutSnapshot() {
        const providers = fanoutProvidersSeen.size ? [...fanoutProvidersSeen] : undefined;
        const skipped = [...fanoutSkippedSeen].filter((p) => !fanoutProvidersSeen.has(p));
        return { fanoutProviders: providers, fanoutSkipped: skipped.length ? skipped : undefined, attempts: [...runAttempts] };
      }

      if (fetchDirect) {
        for (const url of extractDirectUrls(query).slice(0, 3)) {
          const directResult = await fetchDirect({ url, query });
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
              headlessAttempts++;
              const headlessResult = await headlessFetch({ url: directResult.url, query });
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

      if (allEvidence.some((item) => item.sourceKind === 'primary-content')) {
        const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
        const quality = analyzeEvidenceQuality({
          evidence: ranked,
          gaps: allGaps,
          lowValueOutcomes: allLowValueOutcomes,
          partialSearchCoverage: searchCoveragePartial
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
            caveatReasons: quality.caveatReasons,
            ...fanoutSnapshot()
          })
        };
      }

      for (let passIndex = 0; passIndex < DEFAULT_MAX_PASSES; passIndex++) {
        const queries = planSearchQueries({
          originalQuery: query,
          passIndex,
          previousQueries,
          gaps: allGaps.map((gap) => gap.message)
        });

        for (const plannedQuery of queries) {
          previousQueries.push(plannedQuery);
          const pass = await worker.run({
            query: plannedQuery,
            maxSearchRounds: 1,
            maxFetches: DEFAULT_MAX_FETCHES_PER_PASS
          });

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

          const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
          const quality = analyzeEvidenceQuality({
            evidence: ranked,
            gaps: allGaps,
            lowValueOutcomes: allLowValueOutcomes,
            partialSearchCoverage: searchCoveragePartial
          });
          const decision = decideNextResearchStep({
            evidence: ranked,
            suggestedHeadlessUrls,
            passIndex,
            maxPasses: DEFAULT_MAX_PASSES,
            headlessAttempts,
            maxHeadlessAttempts: DEFAULT_MAX_HEADLESS_ATTEMPTS,
            quality
          });

          if (decision.action === 'headless') {
            headlessAttempts++;
            const headlessResult = await headlessFetch({ url: decision.url, query });
            const headlessEvidence = evidenceFromHeadless(headlessResult, query);
            if (headlessEvidence) {
              allEvidence.push(headlessEvidence);
              const updatedRanked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
              const updatedQuality = analyzeEvidenceQuality({
                evidence: updatedRanked,
                gaps: allGaps,
                lowValueOutcomes: allLowValueOutcomes,
                partialSearchCoverage: searchCoveragePartial
              });
              const updatedDecision = decideNextResearchStep({
                evidence: updatedRanked,
                suggestedHeadlessUrls: [],
                passIndex,
                maxPasses: DEFAULT_MAX_PASSES,
                headlessAttempts,
                maxHeadlessAttempts: DEFAULT_MAX_HEADLESS_ATTEMPTS,
                quality: updatedQuality
              });

              const exhaustedBudget = updatedDecision.action !== 'answer' && passIndex + 1 >= DEFAULT_MAX_PASSES;
              return {
                decision: decisionForAnswer({
                  action: updatedDecision.action === 'answer' ? 'answer' : 'answer-with-caveat',
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
                ...fanoutSnapshot()
              })
            };
          }

          if (decision.action === 'answer' || decision.action === 'answer-with-caveat') {
            const exhaustedBudget = decision.action === 'answer-with-caveat' && passIndex + 1 >= DEFAULT_MAX_PASSES;
            return {
              decision: decisionForAnswer({ action: decision.action, query, ranked, exhaustedBudget }),
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
                ...fanoutSnapshot()
              })
            };
          }
        }
      }

      const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
      const quality = analyzeEvidenceQuality({
        evidence: ranked,
        gaps: allGaps,
        lowValueOutcomes: allLowValueOutcomes,
        partialSearchCoverage: searchCoveragePartial
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
          ...fanoutSnapshot()
        })
      };
    }
  };
}
