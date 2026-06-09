import type { ResearchEvidence } from './research-types.js';
import type { EvidenceQualityReport } from './evidence-quality.js';
import { hasOfficialEvidence, strongEvidenceCount } from './evidence-ranker.js';

export type ResearchStepDecision =
  | { action: 'answer' }
  | { action: 'answer-with-caveat' }
  | { action: 'search-again' }
  | { action: 'headless'; url: string };

function activeCaveatReasons(evidence: ResearchEvidence[], quality?: EvidenceQualityReport) {
  const reasons = quality?.caveatReasons ?? [];
  if (!hasOfficialDocsAndApi(evidence)) return reasons;
  return reasons.filter((reason) => reason !== 'low-diversity');
}

function hasQualityConcern(evidence: ResearchEvidence[], quality?: EvidenceQualityReport) {
  return activeCaveatReasons(evidence, quality).length > 0;
}

function hasOfficialDocsAndApi(evidence: ResearchEvidence[]) {
  return evidence.some((item) => item.sourceKind === 'official-docs') &&
    evidence.some((item) => item.sourceKind === 'official-api');
}

function shouldSearchForBetterQuality({
  evidence,
  quality,
  passIndex,
  maxPasses
}: {
  evidence: ResearchEvidence[];
  quality?: EvidenceQualityReport;
  passIndex: number;
  maxPasses: number;
}) {
  if (!quality) return false;
  if (passIndex + 1 >= maxPasses) return false;
  if (quality.flags.hasOnlyCommunityEvidence) return true;
  if (quality.flags.hasLowDiversity && !hasOfficialDocsAndApi(evidence)) return true;
  return false;
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

  if (strongEnough && shouldSearchForBetterQuality({ evidence, quality, passIndex, maxPasses })) {
    return { action: 'search-again' };
  }

  if (strongEnough) {
    return hasQualityConcern(evidence, quality) ? { action: 'answer-with-caveat' } : { action: 'answer' };
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
