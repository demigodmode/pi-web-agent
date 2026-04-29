import type { WebFetchHeadlessResponse } from '../types.js';
import { rankEvidence } from './evidence-ranker.js';
import { planSearchQueries } from './query-planner.js';
import type {
  ResearchEvidence,
  ResearchGap,
  ResearchLowValueOutcome,
  ResearchOrchestratorDecision,
  ResearchWorkerResult
} from './research-types.js';
import { decideNextResearchStep } from './stop-decider.js';

const DEFAULT_MAX_PASSES = 3;
const DEFAULT_MAX_FETCHES_PER_PASS = 4;
const DEFAULT_MAX_HEADLESS_ATTEMPTS = 2;

function fallbackWorkerPass({
  previousQueries,
  allGaps,
  allLowValueOutcomes,
  exhaustedBudget
}: {
  previousQueries: string[];
  allGaps: ResearchGap[];
  allLowValueOutcomes: ResearchLowValueOutcome[];
  exhaustedBudget: boolean;
}): ResearchWorkerResult {
  return {
    searchQueries: previousQueries,
    evidence: [],
    gaps: allGaps,
    lowValueOutcomes: allLowValueOutcomes,
    exhaustedBudget
  };
}

function decisionForAnswer(action: 'answer' | 'answer-with-caveat', query: string, ranked: ResearchEvidence[]): ResearchOrchestratorDecision {
  if (action === 'answer') {
    return {
      action: 'answer',
      rationale: 'Adaptive research gathered enough strong evidence.',
      approvedEvidence: ranked
    };
  }

  return {
    action: 'research-again',
    rationale: 'Research budget exhausted; answer with caveat.',
    followupQuery: query
  };
}

export function createResearchOrchestrator({
  worker,
  headlessFetch
}: {
  worker: {
    run: (input: {
      query: string;
      maxSearchRounds: number;
      maxFetches: number;
    }) => Promise<ResearchWorkerResult>;
  };
  headlessFetch: (input: { url: string }) => Promise<WebFetchHeadlessResponse>;
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
          allEvidence.push(...pass.evidence);
          allGaps.push(...pass.gaps);
          allLowValueOutcomes.push(...pass.lowValueOutcomes);
          if (pass.suggestedHeadlessUrl) suggestedHeadlessUrls.push(pass.suggestedHeadlessUrl);

          const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
          const decision = decideNextResearchStep({
            evidence: ranked,
            suggestedHeadlessUrls,
            passIndex,
            maxPasses: DEFAULT_MAX_PASSES,
            headlessAttempts,
            maxHeadlessAttempts: DEFAULT_MAX_HEADLESS_ATTEMPTS
          });

          if (decision.action === 'headless') {
            headlessAttempts++;
            await headlessFetch({ url: decision.url });
            return {
              decision: {
                action: 'escalate-headless',
                rationale: 'One high-value page is worth a single orchestrator-approved headless retry.',
                url: decision.url,
                approvedEvidence: ranked
              } satisfies ResearchOrchestratorDecision,
              evidence: ranked,
              workerPass: lastPass
            };
          }

          if (decision.action === 'answer' || decision.action === 'answer-with-caveat') {
            return {
              decision: decisionForAnswer(decision.action, query, ranked),
              evidence: ranked,
              workerPass: lastPass
            };
          }
        }
      }

      const ranked = rankEvidence(allEvidence.filter((item) => item.sourceKind !== 'package-page'));
      return {
        decision: decisionForAnswer('answer-with-caveat', query, ranked),
        evidence: ranked,
        workerPass:
          lastPass ??
          fallbackWorkerPass({
            previousQueries,
            allGaps,
            allLowValueOutcomes,
            exhaustedBudget: true
          })
      };
    }
  };
}
