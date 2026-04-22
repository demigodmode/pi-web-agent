import type { WebExploreResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';

export function buildExplorePresentation(result: WebExploreResponse): PresentationEnvelope {
  if (result.status === 'error') {
    return {
      mode: 'compact',
      views: {
        compact: `Research failed: ${result.error?.message ?? 'Unknown research failure.'}`
      }
    };
  }

  const preview = result.findings.map((finding) => `- ${finding}`).join('\n');
  const verbose = [
    'Findings',
    ...result.findings.map((finding) => `- ${finding}`),
    '',
    'Sources',
    ...result.sources.map((source) => `- ${source.title}: ${source.url}`),
    result.caveat ? `\nCaveat\n${result.caveat}` : undefined
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  return {
    mode: 'compact',
    views: {
      compact: `Reviewed ${result.sources.length} sources · synthesized answer with ${result.findings.length} findings`,
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
