import { missingComparisonTargets, type ResearchIntent } from './research-intent.js';
import { planSearchQueries } from './query-planner.js';
import type { ResearchEvidence } from './research-types.js';

type TaskGapInput = {
  query: string;
  intent: ResearchIntent;
  evidence: ResearchEvidence[];
  opinionQuestion: boolean;
  hasPossibleConflict: boolean;
};

// These are the existing planner heuristics, not a semantic assessment.
export function collectTaskPlanningGaps(input: TaskGapInput): string[] {
  const { query, intent, evidence, opinionQuestion, hasPossibleConflict } = input;
  const text = evidence.flatMap((item) => [item.title, item.summary, ...item.supports]).join(' ');
  const gaps = missingComparisonTargets(intent, evidence)
    .map((target) => `Need comparison evidence for target: ${target}`);
  if (/\b(?:versions?|compatibility|supported since)\b/i.test(query) &&
      !/\bv?\d+\.\d+(?:\.\d+)?\b/i.test(text)) gaps.push('Need supported version details.');
  if (/\b(?:API|method|function|parameter)\b/i.test(query) && evidence.length === 0)
    gaps.push('Need exact API behavior.');
  if (opinionQuestion && !evidence.some((item) =>
    item.sourceKind === 'community' || item.sourceKind === 'issue-thread' || item.sourceKind === 'official-discussion'))
    gaps.push('Need user experience.');
  if (hasPossibleConflict) gaps.push('Sources disagree about the recommendation.');
  return gaps;
}

type CallerContextInput = TaskGapInput & {
  requiredFailureUrls: string[];
  executedQueries: string[];
  nextPassIndex: number;
  partial: boolean;
  allowSuggestions: boolean;
};

export function buildCallerContext(input: CallerContextInput) {
  if (!input.partial) return { executedQueries: [...input.executedQueries], openGaps: [], suggestedQueries: [] };
  const failedUrls = new Set(input.requiredFailureUrls);
  const openGaps = collectTaskPlanningGaps(input).filter((gap) => {
    const prefix = 'Need comparison evidence for target: ';
    return !gap.startsWith(prefix) || !failedUrls.has(gap.slice(prefix.length));
  });
  const uniqueGaps = [...new Set(openGaps)];
  // Rule-based proposals only: this function never executes a search.
  const suggestedQueries = input.allowSuggestions && uniqueGaps.length > 0
    ? planSearchQueries({ originalQuery: input.query, passIndex: Math.max(1, input.nextPassIndex),
      previousQueries: input.executedQueries, gaps: uniqueGaps }).slice(0, 2)
    : [];
  return { executedQueries: [...input.executedQueries], openGaps: uniqueGaps, suggestedQueries };
}
