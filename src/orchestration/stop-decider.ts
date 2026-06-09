import type { ResearchEvidence } from './research-types.js';
import type { EvidenceQualityReport } from './evidence-quality.js';
import { hasOfficialEvidence, strongEvidenceCount } from './evidence-ranker.js';

export type ResearchStepDecision =
  | { action: 'answer' }
  | { action: 'answer-with-caveat' }
  | { action: 'search-again' }
  | { action: 'headless'; url: string };

function hasQualityConcern(quality?: EvidenceQualityReport) {
  return (quality?.caveatReasons.length ?? 0) > 0;
}

function shouldSearchForBetterQuality({
  quality,
  passIndex,
  maxPasses
}: {
  quality?: EvidenceQualityReport;
  passIndex: number;
  maxPasses: number;
}) {
  if (!quality) return false;
  if (passIndex + 1 >= maxPasses) return false;
  return quality.flags.hasLowDiversity || quality.flags.hasOnlyCommunityEvidence;
}

export function decideNextResearchStep({
  evidence,
  suggestedHeadlessUrls,
  passIndex,
  maxPasses,
  headlessAttempts,
  maxHeadlessAttempts,
  quality
}: {
  evidence: ResearchEvidence[];
  suggestedHeadlessUrls: string[];
  passIndex: number;
  maxPasses: number;
  headlessAttempts: number;
  maxHeadlessAttempts: number;
  quality?: EvidenceQualityReport;
}): ResearchStepDecision {
  const strongEnough = strongEvidenceCount(evidence) >= 2 && hasOfficialEvidence(evidence);

  if (strongEnough && shouldSearchForBetterQuality({ quality, passIndex, maxPasses })) {
    return { action: 'search-again' };
  }

  if (strongEnough) {
    return hasQualityConcern(quality) ? { action: 'answer-with-caveat' } : { action: 'answer' };
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
