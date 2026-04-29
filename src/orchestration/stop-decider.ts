import type { ResearchEvidence } from './research-types.js';
import { hasOfficialEvidence, strongEvidenceCount } from './evidence-ranker.js';

export type ResearchStepDecision =
  | { action: 'answer' }
  | { action: 'answer-with-caveat' }
  | { action: 'search-again' }
  | { action: 'headless'; url: string };

export function decideNextResearchStep({
  evidence,
  suggestedHeadlessUrls,
  passIndex,
  maxPasses,
  headlessAttempts,
  maxHeadlessAttempts
}: {
  evidence: ResearchEvidence[];
  suggestedHeadlessUrls: string[];
  passIndex: number;
  maxPasses: number;
  headlessAttempts: number;
  maxHeadlessAttempts: number;
}): ResearchStepDecision {
  if (strongEvidenceCount(evidence) >= 2 && hasOfficialEvidence(evidence)) {
    return { action: 'answer' };
  }

  const headlessUrl = suggestedHeadlessUrls.find((url) => !url.includes('npmjs.com/package/'));
  if (headlessUrl && headlessAttempts < maxHeadlessAttempts) {
    return { action: 'headless', url: headlessUrl };
  }

  if (passIndex + 1 < maxPasses) {
    return { action: 'search-again' };
  }

  return { action: 'answer-with-caveat' };
}
