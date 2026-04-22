import type { WebSearchResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';

function formatCompact(result: WebSearchResponse): string {
  if (result.status === 'error') {
    return `Search failed: ${result.error?.message ?? 'Unknown search failure.'}`;
  }

  const suffix = result.results.length === 1 ? 'result' : 'results';
  return `Found ${result.results.length} ${suffix}`;
}

export function buildSearchPresentation(result: WebSearchResponse): PresentationEnvelope {
  const preview = result.results
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title}`)
    .join('\n');

  const verbose = result.results
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.title}\n   ${item.url}\n   ${item.snippet}`)
    .join('\n');

  return {
    mode: 'compact',
    views: {
      compact: formatCompact(result),
      preview: preview || undefined,
      verbose: verbose || undefined
    },
    metrics: {
      resultCount: result.results.length,
      cacheHit: result.metadata.cacheHit
    },
    sources: result.results.map((item) => ({ title: item.title, url: item.url }))
  };
}
