import type { ResearchEvidence } from '../orchestration/research-types.js';
import type { WebExploreResponse } from '../types.js';

const MAX_EXCERPTS_PER_SOURCE = 3;
const MAX_EXCERPT_CHARS = 900;
const MAX_TOTAL_EXCERPT_CHARS = 10_000;

export function buildEvidenceRecords(items: ResearchEvidence[]): NonNullable<WebExploreResponse['evidence']> {
  let remaining = MAX_TOTAL_EXCERPT_CHARS;
  return items.map((item, index) => {
    let sourceRemaining = Math.floor(remaining / (items.length - index));
    let truncated = item.truncated ?? false;
    const excerpts: Array<{ text: string; anchor?: string }> = [];
    const supports = item.supports.slice(0, MAX_EXCERPTS_PER_SOURCE);
    if (item.supports.length > supports.length) truncated = true;
    for (const passage of supports) {
      if (sourceRemaining <= 0) {
        truncated = true;
        break;
      }
      const text = passage.slice(0, Math.min(MAX_EXCERPT_CHARS, sourceRemaining));
      if (text.length < passage.length) truncated = true;
      excerpts.push({ text, ...(item.sectionAnchor ? { anchor: item.sectionAnchor } : {}) });
      remaining -= text.length;
      sourceRemaining -= text.length;
    }
    return {
      id: `S${index + 1}`,
      url: item.url,
      title: item.title,
      method: item.method,
      excerpts,
      ...(item.retrievedAt ? { retrievedAt: item.retrievedAt } : {}),
      truncated
    };
  });
}
