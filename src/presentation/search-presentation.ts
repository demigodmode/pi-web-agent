import type { Attempt, WebSearchResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';

function fanoutNote(result: WebSearchResponse): string {
  const f = result.metadata.fanout;
  if (!f) return '';
  if (f.providers.length) {
    return ` (fanout: ${f.providers.join(', ')}${f.skipped?.length ? `; skipped: ${f.skipped.join(', ')}` : ''})`;
  }
  if (f.skipped?.length) {
    return ` (fanout; skipped: ${f.skipped.join(', ')})`;
  }
  return '';
}

export function attemptLines(attempts: Attempt[] | undefined): string | undefined {
  const interesting = (attempts ?? []).filter((a) => a.outcome !== 'results' && a.outcome !== 'empty');
  if (interesting.length === 0) return undefined;
  return interesting
    .map((a) => {
      const kind = a.failure?.kind ? ` (${a.failure.kind})` : '';
      const until = a.cooldownUntil !== undefined ? `, cooling down until ${new Date(a.cooldownUntil).toISOString()}` : '';
      return `${a.backend}: ${a.outcome}${a.skipReason ? ` [${a.skipReason}]` : ''}${kind}${until}`;
    })
    .join('\n');
}

function formatCompact(result: WebSearchResponse): string {
  const fallbackPrefix = result.metadata.fallbackFrom
    ? `${result.metadata.fallbackFrom} failed; used ${result.metadata.backend} fallback. `
    : '';

  if (result.status === 'error') {
    return `${fallbackPrefix}Search failed: ${result.error?.message ?? 'Unknown search failure.'}${fanoutNote(result)}`;
  }

  const suffix = result.results.length === 1 ? 'result' : 'results';
  return `${fallbackPrefix}Found ${result.results.length} ${suffix}${fanoutNote(result)}`;
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
      verbose: [verbose, attemptLines(result.metadata.attempts)].filter(Boolean).join('\n') || undefined
    },
    metrics: {
      resultCount: result.results.length,
      cacheHit: result.metadata.cacheHit
    },
    sources: result.results.map((item) => ({ title: item.title, url: item.url }))
  };
}
