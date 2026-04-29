import type { ResearchEvidence } from './research-types.js';

function normalizeSummary(summary: string) {
  return summary.replace(/\s+/g, ' ').trim();
}

export function synthesizeAnswer({ evidence, partial }: { evidence: ResearchEvidence[]; partial: boolean }) {
  const findings = evidence.slice(0, 5).map((item) => {
    const summary = normalizeSummary(item.summary);
    return item.sourceKind === 'community' || item.sourceKind === 'issue-thread'
      ? `Community/practical context: ${summary}`
      : summary;
  });

  return {
    findings,
    caveat: partial
      ? 'Evidence is partial, so this answer is based on the strongest source found within the bounded research budget.'
      : undefined
  };
}
