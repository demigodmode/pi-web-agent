import type { ResearchEvidence } from './research-types.js';
import type { EvidenceCaveatReason } from './evidence-quality.js';

function normalizeSummary(summary: string) {
  return summary.replace(/\s+/g, ' ').trim();
}

function sentenceForReason(reason: EvidenceCaveatReason): string {
  switch (reason) {
    case 'community-only':
      return 'the strongest readable sources were mostly community/practical context';
    case 'low-diversity':
      return 'the source set was narrow';
    case 'unreadable-direct-source':
      return 'one or more linked sources could not be read reliably';
    case 'unreadable-thread-source':
      return 'one or more thread sources could not be read reliably';
    case 'possible-conflict':
      return 'readable sources include cautionary or possibly conflicting guidance';
    case 'bot-check':
      return 'some candidate sources showed bot-check or security verification pages';
  }
}

function joinReasons(reasons: string[]) {
  if (reasons.length === 0) return '';
  if (reasons.length === 1) return reasons[0];
  return `${reasons.slice(0, -1).join(', ')}, and ${reasons.at(-1)}`;
}

function caveatText(partial: boolean, caveatReasons: EvidenceCaveatReason[] = []) {
  if (!partial) return undefined;
  const specificReasons = caveatReasons.map(sentenceForReason);
  if (specificReasons.length > 0) {
    return `Evidence is partial: ${joinReasons(specificReasons)}.`;
  }
  return 'Evidence is partial, so this answer is based on the strongest source found within the bounded research budget.';
}

export function synthesizeAnswer({
  evidence,
  partial,
  caveatReasons = []
}: {
  evidence: ResearchEvidence[];
  partial: boolean;
  caveatReasons?: EvidenceCaveatReason[];
}) {
  const findings = evidence.slice(0, 5).map((item) => {
    const summary = normalizeSummary(item.summary);
    return item.sourceKind === 'community' || item.sourceKind === 'issue-thread'
      ? `Community/practical context: ${summary}`
      : summary;
  });

  return {
    findings,
    caveat: caveatText(partial, caveatReasons)
  };
}
