import { selectRelevantExcerpt } from '../extract/section-selector.js';
import type { WebFetchResponse } from '../types.js';
import { rankEvidencePassages, splitEvidenceParagraphs } from './evidence-passages.js';
import type { ResearchEvidence } from './research-types.js';
import { classifySourceProfile } from './source-profile.js';

export function readerEvidence(result: WebFetchResponse, query: string, requestedUrl?: string): ResearchEvidence {
  const content = result.content!;
  const text = content.text;
  return {
    title: content.title ?? result.url,
    url: result.url,
    ...(requestedUrl ? { requestedUrl } : {}),
    method: result.metadata.method,
    sourceKind: classifySourceProfile(result.url).sourceKind,
    summary: selectRelevantExcerpt(text, query, 180),
    supports: splitEvidenceParagraphs(text),
    resultCandidates: rankEvidencePassages(text, query),
    readerDocument: text,
    retrievalCut: result.metadata.retrievalCut ?? false,
    selectionOmitted: result.metadata.selectionOmitted ?? false,
    truncated: result.metadata.truncated ?? false,
    ...(content.sectionAnchor ? { sectionAnchor: content.sectionAnchor } : {}),
    ...(result.metadata.partialComments ? { partialComments: true } : {}),
    ...(result.metadata.cacheHit === false ? { retrievedAt: new Date().toISOString() } : {})
  };
}
