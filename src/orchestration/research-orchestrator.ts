import type { WebFetchHeadlessResponse } from '../types.js';
import type {
  ResearchEvidence,
  ResearchOrchestratorDecision,
  ResearchWorkerResult
} from './research-types.js';

function countOfficialEvidence(evidence: ResearchEvidence[]): number {
  return evidence.filter(
    (item) => item.sourceKind === 'official-docs' || item.sourceKind === 'official-api'
  ).length;
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
      const pass = await worker.run({ query, maxSearchRounds: 1, maxFetches: 3 });
      const officialCount = countOfficialEvidence(pass.evidence);

      if (officialCount >= 1 && pass.evidence.length >= 2) {
        const decision: ResearchOrchestratorDecision = {
          action: 'answer',
          rationale: 'Enough official evidence was gathered in one pass.',
          approvedEvidence: pass.evidence
        };

        return { decision, evidence: pass.evidence, workerPass: pass };
      }

      if (pass.suggestedHeadlessUrls.length > 0) {
        const url = pass.suggestedHeadlessUrls[0];
        await headlessFetch({ url });
        const decision: ResearchOrchestratorDecision = {
          action: 'escalate-headless',
          rationale: 'A specific page was flagged as worth escalating to headless.',
          url,
          approvedEvidence: pass.evidence
        };

        return { decision, evidence: pass.evidence, workerPass: pass };
      }

      const decision: ResearchOrchestratorDecision = {
        action: 'research-again',
        rationale: 'The first pass did not gather enough evidence to answer safely.',
        followupQuery: query
      };

      return { decision, evidence: pass.evidence, workerPass: pass };
    }
  };
}
