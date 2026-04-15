import type { WebFetchHeadlessResponse } from '../types.js';
import type {
  ResearchEvidence,
  ResearchLowValueOutcome,
  ResearchOrchestratorDecision,
  ResearchWorkerResult
} from './research-types.js';

function sourceRank(sourceKind: ResearchEvidence['sourceKind']): number {
  switch (sourceKind) {
    case 'official-docs':
      return 0;
    case 'official-api':
      return 1;
    case 'official-discussion':
      return 2;
    case 'issue-thread':
      return 3;
    case 'community':
      return 4;
    case 'package-page':
      return 5;
    default:
      return 6;
  }
}

function sortEvidence(evidence: ResearchEvidence[]) {
  return [...evidence].sort((left, right) => sourceRank(left.sourceKind) - sourceRank(right.sourceKind));
}

function strongEvidence(evidence: ResearchEvidence[]) {
  return evidence.filter(
    (item) =>
      item.sourceKind === 'official-docs' ||
      item.sourceKind === 'official-api' ||
      item.sourceKind === 'official-discussion'
  );
}

function hasOfficialDocsOrApi(evidence: ResearchEvidence[]) {
  return evidence.some(
    (item) => item.sourceKind === 'official-docs' || item.sourceKind === 'official-api'
  );
}

function hasBotCheck(outcomes: ResearchLowValueOutcome[]) {
  return outcomes.some((outcome) => outcome.kind === 'bot-check');
}

function isHeadlessWorthTrying(pass: ResearchWorkerResult, approvedEvidence: ResearchEvidence[]) {
  if (!pass.suggestedHeadlessUrl) return false;
  if (hasBotCheck(pass.lowValueOutcomes)) return false;
  if (approvedEvidence.length >= 2 && hasOfficialDocsOrApi(approvedEvidence)) return false;

  const candidate = pass.suggestedHeadlessUrl;
  return !candidate.includes('npmjs.com/package/');
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
      const approvedEvidence = sortEvidence(
        pass.evidence.filter((item) => item.sourceKind !== 'package-page')
      );
      const strong = strongEvidence(approvedEvidence);
      const enoughEvidence = strong.length >= 2 && hasOfficialDocsOrApi(approvedEvidence);

      if (enoughEvidence) {
        const decision: ResearchOrchestratorDecision = {
          action: 'answer',
          rationale: 'Two strong sources with official support are enough to answer safely.',
          approvedEvidence
        };

        return { decision, evidence: approvedEvidence, workerPass: pass };
      }

      if (isHeadlessWorthTrying(pass, approvedEvidence)) {
        const url = pass.suggestedHeadlessUrl!;
        await headlessFetch({ url });
        const decision: ResearchOrchestratorDecision = {
          action: 'escalate-headless',
          rationale: 'One high-value page is worth a single orchestrator-approved headless retry.',
          url,
          approvedEvidence
        };

        return { decision, evidence: approvedEvidence, workerPass: pass };
      }

      const hasConcreteGap = pass.gaps.length > 0;
      const onlyLowValueOutcomes = pass.lowValueOutcomes.length > 0 && pass.evidence.length === 0;

      if (!hasConcreteGap || onlyLowValueOutcomes) {
        const decision: ResearchOrchestratorDecision = {
          action: 'research-again',
          rationale: 'Current results did not justify more escalation; continue only with a more targeted pass.',
          followupQuery: query
        };

        return { decision, evidence: approvedEvidence, workerPass: pass };
      }

      const decision: ResearchOrchestratorDecision = {
        action: 'research-again',
        rationale: 'The first pass did not gather enough strong evidence to answer safely.',
        followupQuery: query
      };

      return { decision, evidence: approvedEvidence, workerPass: pass };
    }
  };
}
