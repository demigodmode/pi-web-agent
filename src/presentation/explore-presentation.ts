import type { WebExploreResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';

function internalReaderLabel(method?: 'http' | 'headless') {
  if (method === 'headless') return 'web_fetch_headless';
  if (method === 'http') return 'web_fetch';
  return 'web_explore';
}

export function buildExplorePresentation(result: WebExploreResponse): PresentationEnvelope {
  if (result.status === 'error') {
    return {
      mode: 'compact',
      views: {
        compact: `Research failed: ${result.error?.message ?? 'Unknown research failure.'}`
      }
    };
  }

  const internalSummary = result.metadata
    ? `Internal research: web_search ×${result.metadata.searchPasses}, web_fetch ×${result.metadata.fetchedPages}, web_fetch_headless ×${result.metadata.headlessAttempts}`
    : undefined;
  const hasEvidence = result.findings.length > 0 || result.sources.length > 0;
  const evidenceLines = hasEvidence
    ? result.findings.map((finding, index) => `- [${internalReaderLabel(result.sources[index]?.method)}] ${finding}`)
    : ['No usable evidence found.'];
  const preview = [
    ...evidenceLines,
    internalSummary ? `\n${internalSummary}` : undefined
  ]
    .filter((line) => line !== undefined)
    .join('\n');
  const verbose = [
    'Findings',
    ...evidenceLines,
    '',
    'Sources',
    ...result.sources.map((source) => `- [${internalReaderLabel(source.method)}] ${source.title}: ${source.url}`),
    internalSummary ? `\nInternal tools\n${internalSummary}` : undefined,
    result.caveat ? `\nCaveat\n${result.caveat}` : undefined
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  return {
    mode: 'compact',
    views: {
      compact: hasEvidence
        ? `Reviewed ${result.sources.length} sources · synthesized answer with ${result.findings.length} findings`
        : 'No usable evidence found',
      preview,
      verbose
    },
    metrics: {
      sourceCount: result.sources.length,
      resultCount: result.findings.length
    },
    sources: result.sources
  };
}
