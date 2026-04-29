import type { ResearchEvidence } from './research-types.js';

function sourceRank(sourceKind: ResearchEvidence['sourceKind']) {
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

export function rankEvidence(evidence: ResearchEvidence[]) {
  const bestByUrl = new Map<string, ResearchEvidence>();
  for (const item of evidence) {
    const current = bestByUrl.get(item.url);
    if (!current || sourceRank(item.sourceKind) < sourceRank(current.sourceKind)) {
      bestByUrl.set(item.url, item);
    }
  }

  return [...bestByUrl.values()].sort((left, right) => sourceRank(left.sourceKind) - sourceRank(right.sourceKind));
}

export function hasOfficialEvidence(evidence: ResearchEvidence[]) {
  return evidence.some((item) => item.sourceKind === 'official-docs' || item.sourceKind === 'official-api');
}

export function strongEvidenceCount(evidence: ResearchEvidence[]) {
  return evidence.filter(
    (item) =>
      item.sourceKind === 'official-docs' ||
      item.sourceKind === 'official-api' ||
      item.sourceKind === 'official-discussion'
  ).length;
}
