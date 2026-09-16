import type { FetchMethod, WebExploreResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';
import { attemptLines } from './search-presentation.js';

function internalReaderLabel(method?: FetchMethod) {
  if (method === 'headless') return 'web_fetch_headless';
  if (method === 'firecrawl') return 'firecrawl';
  if (method === 'http') return 'web_fetch';
  if (method === 'github') return 'github';
  if (method === 'pdf') return 'pdf';
  if (method === 'youtube') return 'youtube';
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

  const fanoutProviders = result.metadata?.fanoutProviders;
  const fanoutSkipped = result.metadata?.fanoutSkipped;
  const fanoutNote = fanoutProviders?.length
    ? ` (fanout: ${fanoutProviders.join(', ')}${fanoutSkipped?.length ? `; skipped: ${fanoutSkipped.join(', ')}` : ''})`
    : fanoutSkipped?.length
      ? ` (fanout; skipped: ${fanoutSkipped.join(', ')})`
      : '';
  const internalSummary = result.metadata
    ? `Internal research: web_search ×${result.metadata.searchPasses}${fanoutNote}, web_fetch ×${result.metadata.fetchedPages}, web_fetch_headless ×${result.metadata.headlessAttempts}`
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
    result.caveat ? `\nCaveat\n${result.caveat}` : undefined,
    attemptLines(result.metadata?.attempts)
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const compact = hasEvidence
    ? `Reviewed ${result.sources.length} sources · synthesized answer with ${result.findings.length} findings`
    : 'No usable evidence found';

  return {
    mode: 'compact',
    views: {
      compact,
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
