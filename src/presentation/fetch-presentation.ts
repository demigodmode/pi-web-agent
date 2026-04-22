import type { WebFetchHeadlessResponse, WebFetchResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';

type FetchLike = WebFetchResponse | WebFetchHeadlessResponse;

function countWords(text: string | undefined): number | undefined {
  return text?.trim() ? text.trim().split(/\s+/).length : undefined;
}

function firstExcerpt(text: string | undefined, maxChars = 240): string | undefined {
  if (!text) {
    return undefined;
  }

  return text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}…`;
}

export function buildFetchPresentation(result: FetchLike): PresentationEnvelope {
  const wordCount = countWords(result.content?.text);
  const compact =
    result.status === 'ok'
      ? `Fetched page · article extracted${wordCount ? ` · ${wordCount} words` : ''}`
      : result.status === 'needs_headless'
        ? `Needs headless rendering: ${result.error?.message ?? 'Headless rendering recommended.'}`
        : `Fetch failed: ${result.error?.message ?? 'Unknown fetch failure.'}`;

  return {
    mode: 'compact',
    views: {
      compact,
      preview: result.content?.title
        ? `${result.content.title}\n${firstExcerpt(result.content.text) ?? ''}`.trim()
        : firstExcerpt(result.content?.text),
      verbose:
        result.status === 'ok'
          ? [
              `URL: ${result.url}`,
              result.content?.title ? `Title: ${result.content.title}` : undefined,
              firstExcerpt(result.content?.text, 500)
            ]
              .filter(Boolean)
              .join('\n')
          : undefined
    },
    metrics: {
      wordCount,
      cacheHit: result.metadata.cacheHit
    },
    sources: [{ title: result.content?.title ?? result.url, url: result.url }]
  };
}
