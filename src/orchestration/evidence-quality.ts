import type { ResearchEvidence, ResearchGap, ResearchLowValueOutcome } from './research-types.js';

export type EvidenceCaveatReason =
  | 'community-only'
  | 'low-diversity'
  | 'unreadable-direct-source'
  | 'unreadable-thread-source'
  | 'possible-conflict'
  | 'bot-check';

export type EvidenceQualityReport = {
  counts: {
    total: number;
    official: number;
    community: number;
    thread: number;
    packagePage: number;
    distinctHosts: number;
  };
  flags: {
    hasOfficialEvidence: boolean;
    hasOnlyCommunityEvidence: boolean;
    hasLowDiversity: boolean;
    hasUnreadableDirectSource: boolean;
    hasUnreadableThreadSource: boolean;
    hasPossibleConflict: boolean;
  };
  caveatReasons: EvidenceCaveatReason[];
};

function hostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url.toLowerCase();
  }
}

function hasConflictMarkers(evidence: ResearchEvidence[]) {
  const combined = evidence
    .flatMap((item) => [item.summary, ...item.supports])
    .join('\n')
    .toLowerCase();

  const positive = /\brecommended\b|\buse\b/.test(combined);
  const caution = /\bdeprecated\b|not recommended|use at your own risk|should not/.test(combined);
  return positive && caution;
}

function addReason(reasons: EvidenceCaveatReason[], reason: EvidenceCaveatReason, enabled: boolean) {
  if (enabled && !reasons.includes(reason)) reasons.push(reason);
}

export function analyzeEvidenceQuality({
  evidence,
  gaps,
  lowValueOutcomes
}: {
  evidence: ResearchEvidence[];
  gaps: ResearchGap[];
  lowValueOutcomes: ResearchLowValueOutcome[];
}): EvidenceQualityReport {
  const official = evidence.filter((item) => item.sourceKind === 'official-docs' || item.sourceKind === 'official-api').length;
  const community = evidence.filter((item) => item.sourceKind === 'community').length;
  const thread = evidence.filter((item) => item.sourceKind === 'issue-thread' || item.sourceKind === 'official-discussion').length;
  const packagePage = evidence.filter((item) => item.sourceKind === 'package-page').length;
  const distinctHosts = new Set(evidence.map((item) => hostname(item.url))).size;

  const hasOfficialEvidence = official > 0;
  const hasOnlyCommunityEvidence = evidence.length > 0 && official === 0;
  const hasLowDiversity = evidence.length > 1 && distinctHosts <= 1;
  const hasUnreadableDirectSource = gaps.some((gap) => /Direct URL could not be read reliably/i.test(gap.message));
  const hasUnreadableThreadSource = gaps.some((gap) => /Thread source could not be read reliably/i.test(gap.message));
  const hasPossibleConflict = hasConflictMarkers(evidence);
  const hasBotCheck = lowValueOutcomes.some((outcome) => outcome.kind === 'bot-check');

  const caveatReasons: EvidenceCaveatReason[] = [];
  addReason(caveatReasons, 'community-only', hasOnlyCommunityEvidence);
  addReason(caveatReasons, 'low-diversity', hasLowDiversity);
  addReason(caveatReasons, 'unreadable-direct-source', hasUnreadableDirectSource);
  addReason(caveatReasons, 'unreadable-thread-source', hasUnreadableThreadSource);
  addReason(caveatReasons, 'possible-conflict', hasPossibleConflict);
  addReason(caveatReasons, 'bot-check', hasBotCheck);

  return {
    counts: {
      total: evidence.length,
      official,
      community,
      thread,
      packagePage,
      distinctHosts
    },
    flags: {
      hasOfficialEvidence,
      hasOnlyCommunityEvidence,
      hasLowDiversity,
      hasUnreadableDirectSource,
      hasUnreadableThreadSource,
      hasPossibleConflict
    },
    caveatReasons
  };
}
